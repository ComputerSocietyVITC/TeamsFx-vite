// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * @author  Renlong Tu <rentu@microsoft.com>
 */

import { expect } from "chai";
import path from "path";
import * as fs from "fs-extra";
import {
  cleanUpLocalProject,
  cleanupSharePointPackage,
  execAsync,
  execAsyncWithRetry,
  getTestFolder,
  getUniqueAppName,
} from "../commonUtils";

import { it } from "@microsoft/extra-shot-mocha";
import { isV3Enabled } from "@microsoft/teamsfx-core";

describe("Collaboration", function () {
  const testFolder = getTestFolder();
  let appName = getUniqueAppName();
  let projectPath = path.resolve(testFolder, appName);
  const collaborator = process.env["M365_ACCOUNT_COLLABORATOR"];
  const creator = process.env["M365_ACCOUNT_NAME"];
  let appId: string;

  it(
    "Collaboration: CLI with permission status and permission grant - spfx",
    { testPlanCaseId: 12782618 },
    async function () {
      while (await fs.pathExists(projectPath)) {
        appName = getUniqueAppName();
        projectPath = path.resolve(testFolder, appName);
      }

      // new a project
      await execAsync(
        `teamsfx new --interactive false --capabilities tab-spfx --app-name ${appName}`,
        {
          cwd: testFolder,
          env: process.env,
          timeout: 0,
        }
      );
      console.log(`[Successfully] scaffold to ${projectPath}`);

      // provision
      await execAsyncWithRetry(`teamsfx provision`, {
        cwd: projectPath,
        env: process.env,
        timeout: 0,
      });
      console.log("[Successfully] provision");

      if (isV3Enabled()) {
        const solutionConfig = await fs.readJson(`${projectPath}/src/config/package-solution.json`);
        appId = solutionConfig["solution"]["id"];
      } else {
        const solutionConfig = await fs.readJson(
          `${projectPath}/SPFx/config/package-solution.json`
        );
        appId = solutionConfig["solution"]["id"];
      }

      let checkPermissionResult;
      if (isV3Enabled()) {
        checkPermissionResult = await execAsyncWithRetry(
          `teamsfx permission status --env dev --interactive false`,
          {
            cwd: projectPath,
            env: process.env,
            timeout: 0,
          }
        );
      } else {
        checkPermissionResult = await execAsyncWithRetry(`teamsfx permission status`, {
          cwd: projectPath,
          env: process.env,
          timeout: 0,
        });
      }

      expect(checkPermissionResult.stdout).to.contains(
        "Resource Name: Teams App, Permission: Administrator"
      );
      console.log("[Successfully] check permission");

      let grantCollaboratorResult;

      if (isV3Enabled()) {
        grantCollaboratorResult = await execAsyncWithRetry(
          `teamsfx permission grant --email ${collaborator} --env dev`,
          {
            cwd: projectPath,
            env: process.env,
            timeout: 0,
          }
        );
      } else {
        grantCollaboratorResult = await execAsyncWithRetry(
          `teamsfx permission grant --email ${collaborator}`,
          {
            cwd: projectPath,
            env: process.env,
            timeout: 0,
          }
        );
      }
      // Grant Permission

      expect(grantCollaboratorResult.stdout).to.contains(
        "Administrator permission has been granted to Teams App"
      );
      console.log("[Successfully] grant permission");

      let listCollaboratorResult;

      if (isV3Enabled()) {
        listCollaboratorResult = await execAsync(
          `teamsfx permission status --list-all-collaborators  --env dev`,
          {
            cwd: projectPath,
            env: process.env,
            timeout: 0,
          }
        );
      } else {
        listCollaboratorResult = await execAsync(
          `teamsfx permission status --list-all-collaborators`,
          {
            cwd: projectPath,
            env: process.env,
            timeout: 0,
          }
        );
      }

      // Check collaborator.
      // When collaborator account is guest account in the tenant. Account name pattern will change.
      // e.g. Guest account "account@example.com" will appear as "account_example#EXT#@exampleTenant.onmicrosoft.com" under tenant "exampleTenant".
      // Thus here will check the account name only.
      expect(listCollaboratorResult.stdout).to.contains(
        `Account used to check: ${creator?.split("@")[0]}`
      );
      expect(listCollaboratorResult.stdout).to.contains(
        `Teams App Owner: ${collaborator?.split("@")[0]}`
      );
      console.log("[Successfully] list collaborator");
    }
  );

  after(async () => {
    // clean up
    if (projectPath) {
      await cleanUpLocalProject(projectPath);
    }
    if (appId) {
      await cleanupSharePointPackage(appId);
    }
  });
});
