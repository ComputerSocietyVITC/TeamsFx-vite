// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FxError, Settings, Result, ok, err } from "@microsoft/teamsfx-api";
import * as fs from "fs-extra";
import * as path from "path";
import * as uuid from "uuid";
import { PathNotExistError } from "../../core/error";
import { globalVars } from "../../core/globalVars";
import { parseDocument } from "yaml";
import {
  Component,
  sendTelemetryEvent,
  TelemetryEvent,
  TelemetryProperty,
} from "../../common/telemetry";
import { getProjectSettingPathV3 } from "../../core/middleware/projectSettingsLoader";

export class SettingsUtils {
  async readSettings(
    projectPath: string,
    ensureTrackingId = true
  ): Promise<Result<Settings, FxError>> {
    const projectYamlPath: string = getProjectSettingPathV3(projectPath);
    if (!(await fs.pathExists(projectYamlPath))) {
      return err(new PathNotExistError(projectYamlPath));
    }
    const yamlFileContent: string = await fs.readFile(projectYamlPath, "utf8");
    const appYaml = parseDocument(yamlFileContent);
    if (!appYaml.has("projectId") && ensureTrackingId) {
      const projectId = uuid.v4();
      const projectIdField = appYaml.createPair("projectId", uuid.v4());
      appYaml.add(projectIdField);
      await fs.writeFile(projectYamlPath, appYaml.toString()); // only write yaml file once instead of write yaml file after every command
      sendTelemetryEvent(Component.core, TelemetryEvent.FillProjectId, {
        [TelemetryProperty.ProjectId]: projectId,
      });
    }
    const projectSettings: Settings = {
      trackingId: appYaml.get("projectId") as string,
      version: appYaml.get("version") as string,
    };

    globalVars.trackingId = projectSettings.trackingId; // set trackingId to globalVars
    return ok(projectSettings);
  }
  async writeSettings(projectPath: string, settings: Settings): Promise<Result<string, FxError>> {
    const projectYamlPath: string = getProjectSettingPathV3(projectPath);
    if (!(await fs.pathExists(projectYamlPath))) {
      return err(new PathNotExistError(projectYamlPath));
    }
    const yamlFileContent: string = await fs.readFile(projectYamlPath, "utf8");
    const appYaml = parseDocument(yamlFileContent);
    appYaml.set("projectId", settings.trackingId);
    await fs.writeFile(projectYamlPath, appYaml.toString());
    return ok(projectYamlPath);
  }
}

export const settingsUtil = new SettingsUtils();
