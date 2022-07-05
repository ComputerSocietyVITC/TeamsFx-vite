// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Service } from "typedi";
import { AzureAppService } from "./azureAppService";
@Service("azure-web-app")
export class AzureWebAppResource extends AzureAppService {
  readonly name = "azure-web-app";
  readonly alias = "WA";
  readonly displayName = "Azure Web App";
  readonly bicepModuleName = "azureWebApp";
  readonly outputs = {
    resourceId: {
      key: "resourceId",
      bicepVariable: "provisionOutputs.azureWebApp{{componentName}}Output.value.resourceId",
    },
    endpoint: {
      key: "endpoint",
      bicepVariable: "azureWebApp{{componentName}}Provision.outputs.endpoint",
    },
  };
  readonly finalOutputKeys = ["resourceId", "endpoint"];
}