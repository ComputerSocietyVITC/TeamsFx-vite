// This file implements a `ComponentDialog` class for Single Sign On.
// See https://docs.microsoft.com/en-us/javascript/api/botbuilder-dialogs/componentdialog?view=botbuilder-ts-latest for more about `ComponentDialog`.
// If you are not familiar with this, do not remove or update this file.

import {
  ComponentDialog,
  WaterfallDialog,
  Dialog,
  DialogTurnResult,
  DialogSet,
  DialogTurnStatus,
} from "botbuilder-dialogs";
import { ActivityTypes, Storage, tokenExchangeOperationName, TurnContext } from "botbuilder";
import { TeamsBotSsoPrompt, TeamsBotSsoPromptTokenResponse, TeamsFx } from "@microsoft/teamsfx";
import "isomorphic-fetch";

const DIALOG_NAME = "SSODialog";
const TEAMS_SSO_PROMPT_ID = "TeamsFxSsoPrompt";
const COMMAND_ROUTE_DIALOG = "CommandRouteDialog";

export class SsoDialog extends ComponentDialog {
  private requiredScopes: string[];
  private dedupStorage: Storage;
  private dedupStorageKeys: string[] = [];
  private commandMapping: Map<string, string | RegExp> = new Map<string, string | RegExp>();

  constructor(dedupStorage: Storage, requiredScopes: string[]) {
    super(DIALOG_NAME);

    this.initialDialogId = COMMAND_ROUTE_DIALOG;

    this.dedupStorage = dedupStorage;
    this.dedupStorageKeys = [];
    this.requiredScopes = requiredScopes;

    const teamsFx = new TeamsFx();
    const ssoDialog = new TeamsBotSsoPrompt(teamsFx, TEAMS_SSO_PROMPT_ID, {
      scopes: this.requiredScopes,
      endOnInvalidMessage: true,
    });
    this.addDialog(ssoDialog);

    const commandRouteDialog = new WaterfallDialog(COMMAND_ROUTE_DIALOG, [
      this.commandRouteStep.bind(this),
    ]);
    this.addDialog(commandRouteDialog);
  }

  public addCommand(
    commandId: string,
    commandText: string | RegExp,
    operation: (
      context: TurnContext,
      ssoToken: string,
      ...param: any[]
    ) => Promise<DialogTurnResult>,
    ...param: any[]
  ): void {
    const dialog = new WaterfallDialog(commandId, [
      this.ssoStep.bind(this),
      this.dedupStep.bind(this),
      async (stepContext: any) => {
        const tokenResponse: TeamsBotSsoPromptTokenResponse = stepContext.result;
        const context: TurnContext = stepContext.context;
        try {
          if (tokenResponse) {
            await operation(context, tokenResponse.ssoToken, param);
          } else {
            await context.sendActivity("Failed to retrieve user token from conversation context.");
          }
          return await stepContext.endDialog();
        } catch (error) {
          await context.sendActivity("Failed to retrieve user token from conversation context.");
          await context.sendActivity(error.message);
          return await stepContext.endDialog();
        }
      },
    ]);

    if (this.commandMapping.has(commandId)) {
      throw new Error(`Cannot add command. There is already a command with same id ${commandId}`);
    }
    this.commandMapping.set(commandId, commandText);
    this.addDialog(dialog);
  }

  /**
   * The run method handles the incoming activity (in the form of a DialogContext) and passes it through the dialog system.
   * If no dialog is active, it will start the default dialog.
   * @param {*} dialogContext
   */
  public async run(context: TurnContext, accessor: any) {
    const dialogSet = new DialogSet(accessor);
    dialogSet.add(this);

    const dialogContext = await dialogSet.createContext(context);
    const results = await dialogContext.continueDialog();
    if (results && results.status === DialogTurnStatus.empty) {
      await dialogContext.beginDialog(this.id);
    }
  }

  private async commandRouteStep(stepContext: any) {
    const turnContext = stepContext.context as TurnContext;

    // remove the mention of this bot
    let text = TurnContext.removeRecipientMention(turnContext.activity);
    if (text) {
      // remove the line break
      text = text.toLowerCase().replace(/\n|\r/g, "").trim();
    }

    const commandId = this.matchCommands(text);
    if (commandId) {
      return await stepContext.beginDialog(commandId);
    }
    await stepContext.context.sendActivity(`Cannot find command: ${text}`);
    return await stepContext.endDialog();
  }

  private async ssoStep(stepContext: any) {
    try {
      return await stepContext.beginDialog(TEAMS_SSO_PROMPT_ID);
    } catch (error) {
      const context = stepContext.context;
      await context.sendActivity("Failed to run SSO step");
      await context.sendActivity(error.message);
      return await stepContext.endDialog();
    }
  }

  private async dedupStep(stepContext: any) {
    try {
      const tokenResponse = stepContext.result;
      // Only dedup after ssoStep to make sure that all Teams client would receive the login request
      if (tokenResponse && (await this.shouldDedup(stepContext.context))) {
        return Dialog.EndOfTurn;
      }
      return await stepContext.next(tokenResponse);
    } catch (error) {
      const context = stepContext.context;
      await context.sendActivity("Failed to run dedup step");
      await context.sendActivity(error.message);
      return await stepContext.endDialog();
    }
  }

  public async onEndDialog(context: TurnContext) {
    const conversationId = context.activity.conversation.id;
    const currentDedupKeys = this.dedupStorageKeys.filter((key) => key.indexOf(conversationId) > 0);
    await this.dedupStorage.delete(currentDedupKeys);
    this.dedupStorageKeys = this.dedupStorageKeys.filter((key) => key.indexOf(conversationId) < 0);
  }

  // If a user is signed into multiple Teams clients, the Bot might receive a "signin/tokenExchange" from each client.
  // Each token exchange request for a specific user login will have an identical activity.value.Id.
  // Only one of these token exchange requests should be processed by the bot. For a distributed bot in production,
  // this requires a distributed storage to ensure only one token exchange is processed.
  private async shouldDedup(context: TurnContext): Promise<boolean> {
    const storeItem = {
      eTag: context.activity.value.id,
    };

    const key = this.getStorageKey(context);
    const storeItems = { [key]: storeItem };

    try {
      await this.dedupStorage.write(storeItems);
      this.dedupStorageKeys.push(key);
    } catch (err) {
      if (err instanceof Error && err.message.indexOf("eTag conflict")) {
        return true;
      }
      throw err;
    }
    return false;
  }

  private getStorageKey(context: TurnContext): string {
    if (!context || !context.activity || !context.activity.conversation) {
      throw new Error("Invalid context, can not get storage key!");
    }
    const activity = context.activity;
    const channelId = activity.channelId;
    const conversationId = activity.conversation.id;
    if (activity.type !== ActivityTypes.Invoke || activity.name !== tokenExchangeOperationName) {
      throw new Error("TokenExchangeState can only be used with Invokes of signin/tokenExchange.");
    }
    const value = activity.value;
    if (!value || !value.id) {
      throw new Error("Invalid signin/tokenExchange. Missing activity.value.id.");
    }
    return `${channelId}/${conversationId}/${value.id}`;
  }

  private matchCommands(text: string): string {
    for (const command of this.commandMapping) {
      const pattern: string | RegExp = command[1];
      let matchResult: RegExpExecArray | boolean;
      if (typeof pattern == "string") {
        matchResult = text === pattern;
      } else {
        matchResult = pattern.exec(text);
      }
      if (matchResult) {
        return command[0]; // Return the command id
      }
    }

    return undefined;
  }
}
