// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Inputs, Platform, QTreeNode, Stage } from "@microsoft/teamsfx-api";
import { sampleProvider } from "@microsoft/teamsfx-core/build/common/samples";
import { Options } from "yargs";

export type OptionsMap = { [_: string]: Options };

export const cliSource = "TeamsfxCLI";
export const cliName = "teamsfx";
export const cliTelemetryPrefix = "teamsfx-cli";

export const teamsAppFileName = "teamsapp.yml";

export const RootFolderNode = new QTreeNode({
  type: "folder",
  name: "folder",
  title: "Select root folder of the project",
  default: "./",
});

export const RootFolderOptions: OptionsMap = {
  folder: {
    type: "string",
    global: false,
    description: "Select root folder of the project",
    default: "./",
  },
};

export const EnvNodeNoCreate = new QTreeNode({
  type: "text",
  name: "env",
  title: "Select an existing environment for the project",
});

export const EnvOptions: OptionsMap = {
  env: {
    type: "string",
    global: false,
    description: "Select an existing environment for the project",
  },
};

export const SubscriptionNode = new QTreeNode({
  type: "text",
  name: "subscription",
  title: "Select a subscription",
});

export const CollaboratorEmailNode = new QTreeNode({
  type: "text",
  name: "email",
  title: "Input email address of collaborator",
});

export const ManifestFilePathParamName = "manifest-file-path";
export const OutputZipPathParamName = "output-zip-path";
export const OutputManifestParamName = "output-manifest-path";
export const BuildPackageOptions: OptionsMap = {
  [ManifestFilePathParamName]: {
    type: "string",
    global: false,
    description:
      "Select the Teams app manifest template path, default to '${folder}/appPackage/manifest.json'",
  },
  [OutputZipPathParamName]: {
    type: "string",
    global: false,
    description:
      "Select the output path of the zipped app package, default to '${folder}/build/appPackage/appPackage.${env}.json'",
  },
  [OutputManifestParamName]: {
    type: "string",
    global: false,
    description:
      "Select the output path of the generated manifest path, default to '${folder}/build/appPackage/manifest.${env}.json'",
  },
};

export const AadManifestFilePathName = "manifest-file-path";
export const AadManifestOptions: OptionsMap = {
  [AadManifestFilePathName]: {
    type: "string",
    global: false,
    description:
      "Enter the AAD app manifest template file path, it's a relative path to project root folder, default to './aad.manifest.json'",
  },
};

export const TeamsAppManifestFilePathName = "manifest-file-path";
export const TeamsAppManifestOptions: OptionsMap = {
  [TeamsAppManifestFilePathName]: {
    type: "string",
    global: false,
    description:
      "Enter the Teams app manifest template file path, it's a relative path to project root folder, default to './appPackage/manifest.json'",
  },
};

export const templates = sampleProvider.SampleCollection.samples.map((sample) => {
  return {
    tags: sample.tags,
    title: sample.title,
    description: sample.shortDescription,
    sampleAppName: sample.id,
    sampleAppUrl: sample.link,
  };
});

export enum CLILogLevel {
  error = 0,
  verbose,
  debug,
}

export const sqlPasswordQustionName = "sql-password";

export const sqlPasswordConfirmQuestionName = "sql-confirm-password";

export const deployPluginNodeName = "deploy-plugin";

export const azureSolutionGroupNodeName = "azure-solution-group";

export class FeatureFlags {
  static readonly InsiderPreview = "__TEAMSFX_INSIDER_PREVIEW";
}

export const CLIHelpInputs: Inputs = { platform: Platform.CLI_HELP };

export const AddFeatureFunc = {
  namespace: "fx-solution-azure",
  method: Stage.addFeature,
};

export const EmptyQTreeNode = new QTreeNode({ type: "group" });

export const SUPPORTED_SPFX_VERSION = "1.16.1";
