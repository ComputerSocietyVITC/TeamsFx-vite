// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hooks } from "@feathersjs/hooks/lib";
import {
  FxError,
  Inputs,
  ok,
  Platform,
  Result,
  SettingsFileName,
  SettingsFolderName,
} from "@microsoft/teamsfx-api";
import { assert } from "chai";
import fs from "fs-extra";
import "mocha";
import mockedEnv from "mocked-env";
import * as os from "os";
import * as path from "path";
import sinon from "sinon";
import * as yaml from "js-yaml";
import { getProjectMigratorMW } from "../../../src/core/middleware/projectMigrator";
import { MockTools, MockUserInteraction, randomAppName } from "../utils";
import { CoreHookContext } from "../../../src/core/types";
import { setTools } from "../../../src/core/globalVars";
import { MigrationContext } from "../../../src/core/middleware/utils/migrationContext";
import {
  generateAppYml,
  generateSettingsJson,
} from "../../../src/core/middleware/projectMigratorV3";

let mockedEnvRestore: () => void;

describe("ProjectMigratorMW", () => {
  const sandbox = sinon.createSandbox();
  const appName = randomAppName();
  const projectPath = path.join(os.tmpdir(), appName);

  beforeEach(async () => {
    await fs.ensureDir(projectPath);
    mockedEnvRestore = mockedEnv({
      TEAMSFX_V3_MIGRATION: "true",
    });
    sandbox.stub(MockUserInteraction.prototype, "showMessage").resolves(ok("Upgrade"));
  });

  afterEach(async () => {
    await fs.remove(projectPath);
    sandbox.restore();
    mockedEnvRestore();
  });

  it("happy path", async () => {
    const tools = new MockTools();
    setTools(tools);
    await copyTestProject(Constants.happyPathTestProject, projectPath);
    class MyClass {
      tools = tools;
      async other(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
        return ok("");
      }
    }
    hooks(MyClass, {
      other: [getProjectMigratorMW()],
    });

    const inputs: Inputs = { platform: Platform.VSCode, ignoreEnvInfo: true };
    inputs.projectPath = projectPath;
    const my = new MyClass();
    try {
      const res = await my.other(inputs);
      assert.isTrue(res.isOk());
    } finally {
      await fs.rmdir(inputs.projectPath!, { recursive: true });
    }
  });
});

describe("MigrationContext", () => {
  const sandbox = sinon.createSandbox();
  const appName = randomAppName();
  const projectPath = path.join(os.tmpdir(), appName);

  beforeEach(async () => {
    await fs.ensureDir(projectPath);
    await fs.ensureDir(path.join(projectPath, ".fx"));
  });

  afterEach(async () => {
    await fs.remove(projectPath);
    sandbox.restore();
    mockedEnvRestore();
  });

  it("happy path", async () => {
    const tools = new MockTools();
    setTools(tools);

    const inputs: Inputs = { platform: Platform.VSCode, ignoreEnvInfo: true };
    inputs.projectPath = projectPath;
    const ctx = {
      arguments: [inputs],
    };
    const context = await MigrationContext.create(ctx);
    let res = await context.backup(".fx");
    assert.isTrue(res);
    res = await context.backup("no-exist");
    assert.isFalse(res);
    await context.fsWriteFile("a", "test-data");
    await context.fsCopy("a", "a-copy");
    assert.isTrue(await fs.pathExists(path.join(context.projectPath, "a-copy")));
    await context.fsEnsureDir("b/c");
    assert.isTrue(await fs.pathExists(path.join(context.projectPath, "b/c")));
    await context.fsCreateFile("d");
    assert.isTrue(await fs.pathExists(path.join(context.projectPath, "d")));
    const modifiedPaths = context.getModifiedPaths();
    assert.isTrue(modifiedPaths.includes("a"));
    assert.isTrue(modifiedPaths.includes("a-copy"));
    assert.isTrue(modifiedPaths.includes("b"));
    assert.isTrue(modifiedPaths.includes("b/c"));
    assert.isTrue(modifiedPaths.includes("d"));

    await context.cleanModifiedPaths();
    assert.isEmpty(context.getModifiedPaths());

    await context.restoreBackup();
    await context.cleanTeamsfx();
  });
});

describe("generateSettingsJson", () => {
  const appName = randomAppName();
  const projectPath = path.join(os.tmpdir(), appName);

  beforeEach(async () => {
    await fs.ensureDir(projectPath);
  });

  afterEach(async () => {
    await fs.remove(projectPath);
  });

  it("happy path", async () => {
    const migrationContext = await mockMigrationContext(projectPath);

    await copyTestProject(Constants.happyPathTestProject, projectPath);
    const oldProjectSettings = await readOldProjectSettings(projectPath);

    await generateSettingsJson(migrationContext);

    assert.isTrue(
      await fs.pathExists(path.join(projectPath, SettingsFolderName, SettingsFileName))
    );
    const newSettings = await readSettingJson(projectPath);
    assert.equal(newSettings.trackingId, oldProjectSettings.projectId);
    assert.equal(newSettings.version, "3.0.0");
  });

  it("no project id", async () => {
    const migrationContext = await mockMigrationContext(projectPath);

    await copyTestProject(Constants.happyPathTestProject, projectPath);
    const projectSetting = await readOldProjectSettings(projectPath);
    delete projectSetting.projectId;
    await fs.writeJson(
      path.join(projectPath, Constants.oldProjectSettingsFilePath),
      projectSetting
    );

    await generateSettingsJson(migrationContext);

    const newSettings = await readSettingJson(projectPath);
    assert.isTrue(newSettings.hasOwnProperty("trackingId")); // will auto generate a new trackingId if old project does not have project id
  });
});

describe("generateAppYml-js/ts", () => {
  const appName = randomAppName();
  const projectPath = path.join(os.tmpdir(), appName);

  beforeEach(async () => {
    await fs.ensureDir(projectPath);
  });

  afterEach(async () => {
    await fs.remove(projectPath);
  });

  it("should success in happy path", async () => {
    const migrationContext = await mockMigrationContext(projectPath);
    await copyTestProject(Constants.happyPathTestProject, projectPath);

    await generateAppYml(migrationContext);

    const appYamlPath = path.join(projectPath, Constants.appYmlPath);
    assert.isTrue(await fs.pathExists(appYamlPath));
    const appYaml: any = yaml.load(await fs.readFile(appYamlPath, "utf8"));
    // validate basic part
    assert.equal(appYaml.version, "1.0.0");
    assert.exists(getAction(appYaml.provision, "arm/deploy"));
    assert.exists(getAction(appYaml.registerApp, "teamsApp/create"));
    assert.exists(getAction(appYaml.configureApp, "teamsApp/validate"));
    assert.exists(getAction(appYaml.configureApp, "teamsApp/createAppPackage"));
    assert.exists(getAction(appYaml.configureApp, "teamsApp/update"));
    assert.exists(getAction(appYaml.publish, "teamsApp/validate"));
    assert.exists(getAction(appYaml.publish, "teamsApp/createAppPackage"));
    assert.exists(getAction(appYaml.publish, "teamsApp/publishAppPackage"));
    // validate AAD part
    assert.exists(getAction(appYaml.registerApp, "aadApp/create"));
    assert.exists(getAction(appYaml.configureApp, "aadApp/update"));
    // validate tab part
    const npmCommandActions: Array<any> = getAction(appYaml.deploy, "npm/command");
    assert.exists(
      npmCommandActions.find(
        (item) => item.with.workingDirectory === "tabs" && item.with.args === "install"
      )
    );
    assert.exists(
      npmCommandActions.find(
        (item) => item.with.workingDirectory === "tabs" && item.with.args === "run build"
      )
    );
    assert.exists(getAction(appYaml.deploy, "azureStorage/deploy"));
  });

  it("should not generate AAD part if AAD plugin not activated", async () => {
    const migrationContext = await mockMigrationContext(projectPath);
    await copyTestProject(Constants.happyPathTestProject, projectPath);
    const projectSetting = await readOldProjectSettings(projectPath);
    projectSetting.solutionSettings.activeResourcePlugins = (<Array<string>>(
      projectSetting.solutionSettings.activeResourcePlugins
    )).filter((item) => item !== "fx-resource-aad-app-for-teams"); // remove AAD plugin
    await fs.writeJson(
      path.join(projectPath, Constants.oldProjectSettingsFilePath),
      projectSetting
    );

    await generateAppYml(migrationContext);

    const appYaml: any = yaml.load(
      await fs.readFile(path.join(projectPath, Constants.appYmlPath), "utf8")
    );

    assert.isEmpty(getAction(appYaml.registerApp, "aadApp/create"));
    assert.isEmpty(getAction(appYaml.configureApp, "aadApp/update"));
  });

  it("should not generate tab part if frontend hosting plugin not activated", async () => {
    const migrationContext = await mockMigrationContext(projectPath);
    await copyTestProject(Constants.happyPathTestProject, projectPath);
    const projectSetting = await readOldProjectSettings(projectPath);
    projectSetting.solutionSettings.activeResourcePlugins = (<Array<string>>(
      projectSetting.solutionSettings.activeResourcePlugins
    )).filter((item) => item !== "fx-resource-frontend-hosting"); // remove frontend hosting plugin
    await fs.writeJson(
      path.join(projectPath, Constants.oldProjectSettingsFilePath),
      projectSetting
    );

    await generateAppYml(migrationContext);

    const appYaml: any = yaml.load(
      await fs.readFile(path.join(projectPath, Constants.appYmlPath), "utf8")
    );

    assert.isEmpty(getAction(appYaml.provision, "azureStorage/enableStaticWebsite"));
    const npmCommandActions: Array<any> = getAction(appYaml.deploy, "npm/command");
    assert.isEmpty(npmCommandActions.filter((item) => item.with.workingDirectory === "tabs"));
    assert.isEmpty(getAction(appYaml.deploy, "azureStorage/deploy"));
  });
});

async function mockMigrationContext(projectPath: string): Promise<MigrationContext> {
  const inputs: Inputs = { platform: Platform.VSCode, ignoreEnvInfo: true };
  inputs.projectPath = projectPath;
  const ctx = {
    arguments: [inputs],
  };
  return await MigrationContext.create(ctx);
}

function getTestAssetsPath(projectName: string): string {
  return path.join("tests/core/middleware/testAssets/v3Migration", projectName.toString());
}

async function copyTestProject(projectName: string, targetPath: string): Promise<void> {
  await fs.copy(getTestAssetsPath(projectName), targetPath);
}

async function readOldProjectSettings(projectPath: string): Promise<any> {
  return await fs.readJson(path.join(projectPath, Constants.oldProjectSettingsFilePath));
}

async function readSettingJson(projectPath: string): Promise<any> {
  return await fs.readJson(path.join(projectPath, Constants.settingsFilePath));
}

function getAction(lifecycleDefinition: Array<any>, actionName: string): any[] {
  if (lifecycleDefinition) {
    return lifecycleDefinition.filter((item) => item.uses === actionName);
  }
  return [];
}

const Constants = {
  happyPathTestProject: "happyPath",
  settingsFilePath: "teamsfx/settings.json",
  oldProjectSettingsFilePath: ".fx/configs/projectSettings.json",
  appYmlPath: "teamsfx/app.yml",
};