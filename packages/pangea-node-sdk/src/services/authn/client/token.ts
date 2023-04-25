import PangeaResponse from "../../../response.js";
import BaseService from "../../base.js";
import PangeaConfig from "../../../config.js";
import { AuthN } from "../../../types.js";

export default class ClientToken extends BaseService {
  constructor(token: string, config: PangeaConfig) {
    super("authn", token, config);
    this.apiVersion = "v1";
  }

  /**
   * @summary Check a token
   * @description Look up a token and return its contents.
   * @operationId authn_post_v1_client_token_check
   * @param {String} token - A token value
   * @returns {Promise<PangeaResponse<AuthN.Client.Token.CheckResult>>} - A promise
   * representing an async call to the endpoint
   * @example
   * ```js
   * const response = await authn.client.clientToken.check(
   *   "ptu_wuk7tvtpswyjtlsx52b7yyi2l7zotv4a",
   * );
   * ```
   */
  check(token: string): Promise<PangeaResponse<AuthN.Client.Token.CheckResult>> {
    const data: AuthN.Client.Token.CheckRequest = {
      token: token,
    };
    return this.post("client/token/check", data);
  }
}