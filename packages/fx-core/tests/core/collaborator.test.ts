// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  Platform,
  TokenProvider,
  v2,
  v3,
  UserError,
  err,
  ok,
  ProjectSettingsV3,
  ContextV3,
} from "@microsoft/teamsfx-api";
import { assert } from "chai";
import "mocha";
import os from "os";
import * as path from "path";
import sinon from "sinon";
import * as uuid from "uuid";
import {
  checkPermission,
  CollaborationConstants,
  CollaborationUtil,
  grantPermission,
  listCollaborator,
} from "../../src/core/collaborator";
import { BuiltInFeaturePluginNames } from "../../src/component/constants";
import {
  MockedM365Provider,
  MockedAzureAccountProvider,
  MockedV2Context,
} from "../plugins/solution/util";
import { randomAppName } from "./utils";
import { Container } from "typedi";
import { AppManifest } from "../../src/component/resource/appManifest/appManifest";
import { ComponentNames } from "../../src/component/constants";
import { hasAAD, hasAzureResource, hasSPFx } from "../../src/common/projectSettingsHelper";
import { CollaborationState } from "../../src/common/permissionInterface";
import { SolutionError } from "../../src/component/constants";
import { AadApp } from "../../src/component/resource/aadApp/aadApp";
import fs from "fs-extra";
import { FeatureFlagName } from "../../src/common/constants";
import mockedEnv, { RestoreFn } from "mocked-env";

describe("Collaborator APIs for V3", () => {
  const sandbox = sinon.createSandbox();
  const projectSettings: ProjectSettingsV3 = {
    appName: "my app",
    projectId: uuid.v4(),
    solutionSettings: {
      name: "fx-solution-azure",
      version: "3.0.0",
      capabilities: ["Tab"],
      hostType: "Azure",
      azureResources: [],
      activeResourcePlugins: [],
    },
    components: [],
  };
  const ctx = new MockedV2Context(projectSettings) as ContextV3;
  const inputs: v2.InputsWithProjectPath = {
    platform: Platform.VSCode,
    projectPath: path.join(os.tmpdir(), randomAppName()),
  };
  const tokenProvider: TokenProvider = {
    azureAccountProvider: new MockedAzureAccountProvider(),
    m365TokenProvider: new MockedM365Provider(),
  };
  ctx.tokenProvider = tokenProvider;
  beforeEach(() => {});
  afterEach(() => {
    sandbox.restore();
  });

  describe("plugin check", () => {
    it("hasAAD: yes", async () => {
      projectSettings.solutionSettings!.activeResourcePlugins = [
        BuiltInFeaturePluginNames.aad,
        BuiltInFeaturePluginNames.frontend,
      ];
      assert.isTrue(hasAAD(projectSettings));
    });

    it("hasAAD: no", async () => {
      projectSettings.solutionSettings!.activeResourcePlugins = [
        BuiltInFeaturePluginNames.frontend,
        BuiltInFeaturePluginNames.identity,
      ];
      assert.isFalse(hasAAD(projectSettings));
    });

    it("hasSPFx: yes", async () => {
      projectSettings.solutionSettings!.activeResourcePlugins = [
        BuiltInFeaturePluginNames.spfx,
        BuiltInFeaturePluginNames.aad,
      ];
      assert.isTrue(hasSPFx(projectSettings));
    });

    it("hasSPFx: no", async () => {
      projectSettings.solutionSettings!.activeResourcePlugins = [
        BuiltInFeaturePluginNames.frontend,
      ];
      assert.isFalse(hasSPFx(projectSettings));
    });

    it("hasAzureResource: yes", async () => {
      projectSettings.solutionSettings!.activeResourcePlugins = [
        BuiltInFeaturePluginNames.spfx,
        BuiltInFeaturePluginNames.aad,
        BuiltInFeaturePluginNames.frontend,
      ];
      assert.isTrue(hasAzureResource(projectSettings));
    });

    it("hasAzureResource: no", async () => {
      projectSettings.solutionSettings!.activeResourcePlugins = [BuiltInFeaturePluginNames.spfx];
      assert.isFalse(hasAAD(projectSettings));
    });
  });

  describe("listCollaborator", () => {
    let mockedEnvRestore: RestoreFn;
    beforeEach(() => {
      mockedEnvRestore = mockedEnv({ TEAMSFX_V3: "false" });
    });
    afterEach(() => {
      mockedEnvRestore();
    });
    it("should return NotProvisioned state if Teamsfx project hasn't been provisioned", async () => {
      sandbox.stub(CollaborationUtil, "getUserInfo").resolves({
        tenantId: "fake_tid",
        aadId: "fake_oid",
        userPrincipalName: "fake_unique_name",
        displayName: "displayName",
        isAdministrator: true,
      });
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: { solution: {} },
        config: {},
      };
      const result = await listCollaborator(ctx, inputs, envInfo, tokenProvider);
      if (result.isErr()) {
        console.log(`!!! ${result.error.name}: ${result.error.message}`);
      }
      assert.isTrue(result.isOk());
      if (result.isOk()) {
        assert.equal(result.value.state, CollaborationState.NotProvisioned);
      }
    });
    it("should return error if cannot get user info", async () => {
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: { solution: { provisionSucceeded: true } },
        config: {},
      };
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(undefined);
      const result = await listCollaborator(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.FailedToRetrieveUserInfo);
    });

    it("should return M365TenantNotMatch state if tenant is not match", async () => {
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "fake_tid",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      const result = await listCollaborator(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.state === CollaborationState.M365TenantNotMatch);
    });

    it("should return error if list collaborator failed", async () => {
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "mock_project_tenant_id",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      sandbox
        .stub(appStudio, "listCollaborator")
        .resolves(
          err(
            new UserError(
              "AppStudioPlugin",
              SolutionError.FailedToListCollaborator,
              "List collaborator failed."
            )
          )
        );
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      inputs.platform = Platform.CLI;
      const result = await listCollaborator(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.FailedToListCollaborator);
    });

    it("happy path", async () => {
      ctx.projectSetting.components = [
        {
          name: "teams-app",
          hosting: "azure-storage",
          sso: true,
        },
        {
          name: "aad-app",
          provision: true,
        },
        {
          name: "identity",
          provision: true,
        },
      ];

      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };

      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "mock_project_tenant_id",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      sandbox.stub(aadPlugin, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      const result = await listCollaborator(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.collaborators!.length === 1);
    });

    it("happy path without aad", async () => {
      ctx.projectSetting.components = [
        {
          name: "teams-app",
          hosting: "azure-storage",
          sso: true,
        },
        {
          name: "identity",
          provision: true,
        },
      ];

      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };

      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "mock_project_tenant_id",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      sandbox.stub(appStudio, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      const result = await listCollaborator(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.collaborators!.length === 1);
    });
  });

  describe("checkPermission", () => {
    let mockedEnvRestore: RestoreFn;
    beforeEach(() => {
      mockedEnvRestore = mockedEnv({ TEAMSFX_V3: "false" });
    });
    afterEach(() => {
      mockedEnvRestore();
    });
    it("should return NotProvisioned state if Teamsfx project hasn't been provisioned", async () => {
      sandbox.stub(CollaborationUtil, "getUserInfo").resolves({
        tenantId: "fake_tid",
        aadId: "fake_oid",
        userPrincipalName: "fake_unique_name",
        displayName: "displayName",
        isAdministrator: true,
      });
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: { solution: {} },
        config: {},
      };
      const result = await checkPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.state === CollaborationState.NotProvisioned);
    });

    it("should return error if cannot get user info", async () => {
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: { solution: { provisionSucceeded: true } },
        config: {},
      };
      sandbox
        .stub(tokenProvider.m365TokenProvider, "getJsonObject")
        .resolves(err(new UserError("source", "name", "message")));
      const result = await checkPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.FailedToRetrieveUserInfo);
    });

    it("should return M365TenantNotMatch state if tenant is not match", async () => {
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "fake_tid",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      const result = await checkPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.state === CollaborationState.M365TenantNotMatch);
    });

    it("should return error if check permission failed", async () => {
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "mock_project_tenant_id",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      sandbox
        .stub(appStudio, "checkPermission")
        .resolves(
          err(
            new UserError(
              "AppStudioPlugin",
              SolutionError.FailedToCheckPermission,
              "List collaborator failed."
            )
          )
        );
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      const result = await checkPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.FailedToCheckPermission);
    });
    it("happy path", async () => {
      ctx.projectSetting.components = [
        {
          name: "teams-app",
          hosting: "azure-storage",
          sso: true,
        },
        {
          name: "aad-app",
          provision: true,
        },
        {
          name: "identity",
          provision: true,
        },
      ];

      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };

      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "mock_project_tenant_id",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "checkPermission").resolves(
        ok([
          {
            name: "teams_app",
            resourceId: "fake_teams_app_resource_id",
            roles: ["Administrator"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(aadPlugin, "checkPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      inputs.platform = Platform.CLI;
      const result = await checkPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.permissions!.length === 2);
    });
  });
  describe("grantPermission", () => {
    let mockedEnvRestore: RestoreFn;
    beforeEach(() => {
      mockedEnvRestore = mockedEnv({ TEAMSFX_V3: "false" });
    });
    afterEach(() => {
      mockedEnvRestore();
    });
    it("should return NotProvisioned state if Teamsfx project hasn't been provisioned", async () => {
      sandbox.stub(CollaborationUtil, "getUserInfo").resolves({
        tenantId: "fake_tid",
        aadId: "fake_oid",
        userPrincipalName: "fake_unique_name",
        displayName: "displayName",
        isAdministrator: true,
      });
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: { solution: {} },
        config: {},
      };
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.state === CollaborationState.NotProvisioned);
    });
    it("should return error if cannot get current user info", async () => {
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: { solution: { provisionSucceeded: true } },
        config: {},
      };
      sandbox
        .stub(tokenProvider.m365TokenProvider, "getJsonObject")
        .resolves(err(new UserError("source", "name", "message")));
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.FailedToRetrieveUserInfo);
    });
    it("should return M365TenantNotMatch state if tenant is not match", async () => {
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "fake_tid",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.state === CollaborationState.M365TenantNotMatch);
    });
    it("should return error if user email is undefined", async () => {
      sandbox
        .stub(tokenProvider.m365TokenProvider, "getJsonObject")
        .onCall(0)
        .resolves(
          ok({
            tid: "mock_project_tenant_id",
            oid: "fake_oid",
            unique_name: "fake_unique_name",
            name: "fake_name",
          })
        )
        .onCall(1)
        .resolves(undefined);
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.EmailCannotBeEmptyOrSame);
    });
    it("should return error if cannot find user from email", async () => {
      sandbox
        .stub(tokenProvider.m365TokenProvider, "getJsonObject")
        .onCall(0)
        .resolves(
          ok({
            tid: "mock_project_tenant_id",
            oid: "fake_oid",
            unique_name: "fake_unique_name",
            name: "fake_name",
          })
        )
        .onCall(1)
        .resolves(undefined);
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      inputs.email = "your_collaborator@yourcompany.com";
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(
        result.isErr() && result.error.name === SolutionError.CannotFindUserInCurrentTenant
      );
    });
    it("should return error if grant permission failed", async () => {
      ctx.projectSetting.solutionSettings!.activeResourcePlugins = ["fx-resource-frontend-hosting"];
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      sandbox
        .stub(tokenProvider.m365TokenProvider, "getJsonObject")
        .onCall(0)
        .resolves(
          ok({
            tid: "mock_project_tenant_id",
            oid: "fake_oid",
            unique_name: "fake_unique_name",
            name: "fake_name",
          })
        )
        .onCall(1)
        .resolves(
          ok({
            tid: "mock_project_tenant_id",
            oid: "fake_oid_2",
            unique_name: "fake_unique_name_2",
            name: "fake_name_2",
          })
        );

      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });

      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      sandbox
        .stub(appStudio, "grantPermission")
        .resolves(
          err(
            new UserError(
              "AppStudioPlugin",
              SolutionError.FailedToGrantPermission,
              "Grant permission failed."
            )
          )
        );
      inputs.email = "your_collaborator@yourcompany.com";
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === SolutionError.FailedToGrantPermission);
    });
    it("happy path", async () => {
      ctx.projectSetting.components = [
        {
          name: "teams-app",
          hosting: "azure-storage",
          sso: true,
        },
        {
          name: "aad-app",
          provision: true,
        },
        {
          name: "identity",
          provision: true,
        },
      ];

      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };

      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "grantPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(aadPlugin, "grantPermission").resolves(
        ok([
          {
            name: "teams_app",
            resourceId: "fake_teams_app_resource_id",
            roles: ["Administrator"],
            type: "M365",
          },
        ])
      );
      inputs.email = "your_collaborator@yourcompany.com";
      inputs.platform = Platform.CLI;
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.permissions!.length === 2);
    });

    it("happy path without aad", async () => {
      ctx.projectSetting.components = [
        {
          name: "teams-app",
          hosting: "azure-storage",
          sso: true,
        },
        {
          name: "identity",
          provision: true,
        },
      ];
      const envInfo: v3.EnvInfoV3 = {
        envName: "dev",
        state: {
          solution: { provisionSucceeded: true },
          "app-manifest": { tenantId: "mock_project_tenant_id" },
        },
        config: {},
      };
      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      sandbox.stub(appStudio, "grantPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      inputs.email = "your_collaborator@yourcompany.com";
      const result = await grantPermission(ctx, inputs, envInfo, tokenProvider);
      assert.isTrue(result.isOk() && result.value.permissions!.length === 1);
    });
  });

  describe("loadDotEnvFile v3", () => {
    let mockedEnvRestore: RestoreFn;

    beforeEach(() => {
      mockedEnvRestore = mockedEnv({ [FeatureFlagName.V3]: "true" });
    });
    afterEach(() => {
      mockedEnvRestore();
      sandbox.restore();
    });
    it("happy path", async () => {
      sandbox.stub(fs, "pathExists").resolves(true);
      sandbox
        .stub(fs, "readFile")
        .resolves(
          Buffer.from(
            "AAD_APP_OBJECT_ID=aadObjectId\n TEAMS_APP_ID=teamsAppId\n TEAMS_APP_TENANT_ID=tenantId"
          )
        );

      const result = await CollaborationUtil.loadDotEnvFile("filePath");
      assert.isTrue(result.isOk());
      if (result.isOk()) {
        assert.equal(result.value[CollaborationConstants.TeamsAppIdEnv], "teamsAppId");
        assert.equal(result.value[CollaborationConstants.AadObjectIdEnv], "aadObjectId");
        assert.equal(result.value[CollaborationConstants.TeamsAppTenantIdEnv], "tenantId");
      }
    });

    it("file path error", async () => {
      sandbox.stub(fs, "pathExists").resolves(false);
      const result = await CollaborationUtil.loadDotEnvFile("filepath");
      assert.isTrue(result.isErr());
      if (result.isErr()) {
        assert.equal(result.error.name, SolutionError.FailedToLoadDotEnvFile);
      }
    });

    it("load env failed", async () => {
      sandbox.stub(fs, "pathExists").resolves(true);
      sandbox.stub(fs, "readFile").throws(new Error("failed to load env"));
      const result = await CollaborationUtil.loadDotEnvFile("filepath");
      if (result.isErr()) {
        assert.equal(result.error.name, SolutionError.FailedToLoadDotEnvFile);
      }
    });
  });

  describe("getTeamsAppIdAndAadObjectId v3", () => {
    let mockedEnvRestore: RestoreFn;

    beforeEach(() => {
      mockedEnvRestore = mockedEnv({ [FeatureFlagName.V3]: "true" });
    });
    afterEach(() => {
      mockedEnvRestore();
      sandbox.restore();
    });

    it("happy path vsc", async () => {
      const mockedEnvTmp: RestoreFn = mockedEnv({
        [CollaborationConstants.TeamsAppIdEnv]: "teamsAppId",
        [CollaborationConstants.AadObjectIdEnv]: "aadObjectId",
      });
      const result = await CollaborationUtil.getTeamsAppIdAndAadObjectId(inputs);
      assert.isTrue(result.isOk());
      if (result.isOk()) {
        const appId = result.value;
        assert.equal(appId.teamsAppId, "teamsAppId");
        assert.equal(appId.aadObjectId, "aadObjectId");
      }
      mockedEnvTmp();
    });

    it("happy path cli: get from parameter", async () => {
      const inputsCli: v2.InputsWithProjectPath = {
        platform: Platform.CLI,
        projectPath: path.join(os.tmpdir(), randomAppName()),
        teamsAppId: "teamsAppId",
        aadObjectId: "aadObjectId",
      };
      const result = await CollaborationUtil.getTeamsAppIdAndAadObjectId(inputsCli);
      assert.isTrue(result.isOk());
      if (result.isOk()) {
        const appId = result.value;
        assert.equal(appId.teamsAppId, "teamsAppId");
        assert.equal(appId.aadObjectId, "aadObjectId");
      }
    });

    it("happy path cli: get from dotenv", async () => {
      const inputsCli: v2.InputsWithProjectPath = {
        platform: Platform.CLI,
        projectPath: path.join(os.tmpdir(), randomAppName()),
        dotEnvFilePath: "filePath",
      };
      sandbox.stub(CollaborationUtil, "loadDotEnvFile").resolves(
        ok({
          [CollaborationConstants.TeamsAppIdEnv]: "teamsAppId",
          [CollaborationConstants.AadObjectIdEnv]: "aadObjectId",
        })
      );
      const result = await CollaborationUtil.getTeamsAppIdAndAadObjectId(inputsCli);
      assert.isTrue(result.isOk());
      console.log(result);
      if (result.isOk()) {
        const appId = result.value;
        assert.equal(appId.teamsAppId, "teamsAppId");
        assert.equal(appId.aadObjectId, "aadObjectId");
      }
    });

    it("happy path cli: get from env", async () => {
      const inputsCli: v2.InputsWithProjectPath = {
        platform: Platform.CLI,
        projectPath: path.join(os.tmpdir(), randomAppName()),
      };
      const mockedEnvTmp: RestoreFn = mockedEnv({
        [CollaborationConstants.TeamsAppIdEnv]: "teamsAppId",
        [CollaborationConstants.AadObjectIdEnv]: "aadObjectId",
      });
      const result = await CollaborationUtil.getTeamsAppIdAndAadObjectId(inputsCli);
      assert.isTrue(result.isOk());
      if (result.isOk()) {
        const appId = result.value;
        assert.equal(appId.teamsAppId, "teamsAppId");
        assert.equal(appId.aadObjectId, "aadObjectId");
      }
      mockedEnvTmp();
    });

    it("load DotEnv failed", async () => {
      const inputsCli: v2.InputsWithProjectPath = {
        platform: Platform.CLI,
        projectPath: path.join(os.tmpdir(), randomAppName()),
        dotEnvFilePath: "filePath",
      };
      sandbox
        .stub(CollaborationUtil, "loadDotEnvFile")
        .resolves(err(new UserError("source", "errorName", "errorMessage")));
      const result = await CollaborationUtil.getTeamsAppIdAndAadObjectId(inputsCli);
      assert.isTrue(result.isErr());
      if (result.isErr()) {
        assert.equal(result.error.name, "errorName");
      }
    });

    it("failed to get teamsAppId", async () => {
      const inputsCli: v2.InputsWithProjectPath = {
        platform: Platform.VSCode,
        projectPath: path.join(os.tmpdir(), randomAppName()),
      };
      const mockedEnvTmp: RestoreFn = mockedEnv({
        [CollaborationConstants.TeamsAppIdEnv]: undefined,
        [CollaborationConstants.AadObjectIdEnv]: undefined,
      });
      const result = await CollaborationUtil.getTeamsAppIdAndAadObjectId(inputsCli);
      assert.isTrue(result.isErr());
      if (result.isErr()) {
        assert.equal(result.error.name, SolutionError.FailedToGetTeamsAppId);
      }
      mockedEnvTmp();
    });
  });

  describe("collaboration v3", () => {
    let mockedEnvRestore: RestoreFn;

    beforeEach(() => {
      mockedEnvRestore = mockedEnv({ [FeatureFlagName.V3]: "true" });
      sandbox.stub(tokenProvider.m365TokenProvider, "getJsonObject").resolves(
        ok({
          tid: "mock_project_tenant_id",
          oid: "fake_oid",
          unique_name: "fake_unique_name",
          name: "fake_name",
        })
      );
    });
    afterEach(() => {
      mockedEnvRestore();
      sandbox.restore();
    });

    it("listCollaborator: happy path", async () => {
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      sandbox.stub(aadPlugin, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      sandbox.stub(CollaborationUtil, "getTeamsAppIdAndAadObjectId").resolves(
        ok({
          teamsAppId: "teamsAppId",
          aadObjectId: "aadObjectId",
        })
      );

      inputs.platform == Platform.CLI;
      inputs.env = "dev";

      const result = await listCollaborator(ctx, inputs, undefined, tokenProvider);
      assert.isTrue(result.isOk() && result.value.collaborators!.length === 1);
    });

    it("list collaborator: failed to read teams app id", async () => {
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      sandbox.stub(aadPlugin, "listCollaborator").resolves(
        ok([
          {
            userObjectId: "fake-aad-user-object-id",
            resourceId: "fake-resource-id",
            displayName: "fake-display-name",
            userPrincipalName: "fake-user-principal-name",
          },
        ])
      );
      sandbox
        .stub(CollaborationUtil, "getTeamsAppIdAndAadObjectId")
        .resolves(err(new UserError("source", "errorName", "errorMessage")));

      inputs.platform == Platform.CLI;
      inputs.env = "dev";

      const result = await listCollaborator(ctx, inputs, undefined, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === "errorName");
    });

    it("grantPermission: happy path", async () => {
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "grantPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(aadPlugin, "grantPermission").resolves(
        ok([
          {
            name: "teams_app",
            resourceId: "fake_teams_app_resource_id",
            roles: ["Administrator"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(CollaborationUtil, "getTeamsAppIdAndAadObjectId").resolves(
        ok({
          teamsAppId: "teamsAppId",
          aadObjectId: "aadObjectId",
        })
      );
      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });

      inputs.platform == Platform.CLI;
      inputs.email = "your_collaborator@yourcompany.com";
      inputs.env = "dev";

      const result = await grantPermission(ctx, inputs, undefined, tokenProvider);
      assert.isTrue(result.isOk() && result.value.permissions!.length === 2);
    });

    it("grantPermission: failed to read teams app id", async () => {
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "grantPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(aadPlugin, "grantPermission").resolves(
        ok([
          {
            name: "teams_app",
            resourceId: "fake_teams_app_resource_id",
            roles: ["Administrator"],
            type: "M365",
          },
        ])
      );
      sandbox
        .stub(CollaborationUtil, "getTeamsAppIdAndAadObjectId")
        .resolves(err(new UserError("source", "errorName", "errorMessage")));
      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });

      inputs.platform == Platform.CLI;
      inputs.env = "dev";
      inputs.email = "your_collaborator@yourcompany.com";

      const result = await grantPermission(ctx, inputs, undefined, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === "errorName");
    });

    it("checkPermission: happy path", async () => {
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "checkPermission").resolves(
        ok([
          {
            name: "teams_app",
            resourceId: "fake_teams_app_resource_id",
            roles: ["Administrator"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(aadPlugin, "checkPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(CollaborationUtil, "getTeamsAppIdAndAadObjectId").resolves(
        ok({
          teamsAppId: "teamsAppId",
          aadObjectId: "aadObjectId",
        })
      );
      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });

      inputs.platform == Platform.CLI;
      inputs.env = "dev";

      const result = await checkPermission(ctx, inputs, undefined, tokenProvider);
      assert.isTrue(result.isOk() && result.value.permissions!.length === 2);
    });

    it("checkPermission: failed to read teams app id", async () => {
      const appStudio = Container.get<AppManifest>(ComponentNames.AppManifest);
      const aadPlugin = Container.get<AadApp>(ComponentNames.AadApp);
      sandbox.stub(appStudio, "checkPermission").resolves(
        ok([
          {
            name: "teams_app",
            resourceId: "fake_teams_app_resource_id",
            roles: ["Administrator"],
            type: "M365",
          },
        ])
      );
      sandbox.stub(aadPlugin, "checkPermission").resolves(
        ok([
          {
            name: "aad_app",
            resourceId: "fake_aad_app_resource_id",
            roles: ["Owner"],
            type: "M365",
          },
        ])
      );
      sandbox
        .stub(CollaborationUtil, "getTeamsAppIdAndAadObjectId")
        .resolves(err(new UserError("source", "errorName", "errorMessage")));
      sandbox
        .stub(CollaborationUtil, "getUserInfo")
        .onCall(0)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName",
          displayName: "displayName",
          isAdministrator: true,
        })
        .onCall(1)
        .resolves({
          tenantId: "mock_project_tenant_id",
          aadId: "aadId",
          userPrincipalName: "userPrincipalName2",
          displayName: "displayName2",
          isAdministrator: true,
        });

      inputs.platform == Platform.CLI;
      inputs.env = "dev";

      const result = await checkPermission(ctx, inputs, undefined, tokenProvider);
      assert.isTrue(result.isErr() && result.error.name === "errorName");
    });
  });
});
