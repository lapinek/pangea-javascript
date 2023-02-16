import axios, { AxiosResponse } from "axios";

import AuthNClient from "@src/AuthNClient";

import { APIResponse, AuthConfig, ClientResponse } from "@src/types";

import {
  AuthNFlowOptions,
  FlowStep,
  FlowState,
  FlowStart,
  FlowSignupPassword,
  FlowVerifyPassword,
  FlowVerifyCallback,
  FlowVerifyCaptcha,
  FlowMfaStart,
  FlowMfaComplete,
} from "./types";

const DEFAULT_FLOW_OPTIONS = {
  signin: true,
  signup: true,
};

const DEFAULT_FLOW_STATE: FlowState = {
  step: FlowStep.START,
  flowId: "",
  email: "",
  selectedMfa: "",
  mfaProviders: [],
  recaptchaKey: "",
  qrCode: "",
  passwordSignup: true,
  socialSignup: {},
  redirectUri: "",
};

const API_FLOW_BASE = "flow";

export class AuthNFlowClient extends AuthNClient {
  state: FlowState;
  options: AuthNFlowOptions;

  constructor(config: AuthConfig, options?: AuthNFlowOptions) {
    super(config);

    this.options = {
      ...DEFAULT_FLOW_OPTIONS,
      ...options,
    };

    this.state = {
      ...DEFAULT_FLOW_STATE,
    };
  }

  initState(flowState: FlowState) {
    this.state = {
      ...this.state,
      ...flowState,
    };
  }

  /*
    Auth Flow functions
  */

  async start(data: FlowStart): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.START}`;
    const flowTypes = [];

    if (this.options.signup) {
      flowTypes.push("signup");
    }
    if (this.options.signin) {
      flowTypes.push("signin");
    }

    const payload: any = {
      cb_uri: this.config.callbackUri,
      flow_types: flowTypes,
    };

    if (data.email) {
      payload.email = data.email;
    }

    const { success, response } = await this.post(path, payload, false);

    if (success) {
      // only update to the next step for 'start' calls with an email
      if (payload.email) {
        this.state.step = response.result?.next_step;
        this.state.email = payload.email;
      } else {
        // store configured signup methods
        if (response.result?.signup?.password_signup === null) {
          this.state.passwordSignup = true;
        }
        if (response.result?.signup?.social_signup) {
          this.state.socialSignup = { ...response.result.signup.social_signup };
        }
      }

      // store flow_id
      this.state.flowId = response.result.flow_id;

      // store recapta key
      if (response.result?.verify_captcha?.site_key) {
        this.state.recaptchaKey = response.result.verify_captcha.site_key;
      }
    }

    return { success, response };
  }

  async signupPassword(data: FlowSignupPassword): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.SIGNUP_PASSWORD}`;
    const payload = {
      flow_id: this.state.flowId,
      first_name: data.firstName,
      last_name: data.lastName,
      password: data.password,
    };

    return await this.post(path, payload);
  }

  async signupSocial(data: FlowVerifyCallback): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.SIGNUP_SOCIAL}`;
    const payload = {
      flow_id: this.state.flowId,
      cb_code: data.cbCode,
      cb_state: data.cbState,
    };

    return await this.post(path, payload);
  }

  async verifySocial(data: FlowVerifyCallback): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.VERIFY_SOCIAL}`;
    const payload = {
      flow_id: this.state.flowId,
      cb_code: data.cbCode,
      cb_state: data.cbState,
    };

    return await this.post(path, payload);
  }

  async verifyPassword(data: FlowVerifyPassword): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.VERIFY_PASSWORD}`;
    const payload = {
      flow_id: this.state.flowId,
      password: data.password,
    };

    return await this.post(path, payload);
  }

  async verifyCaptcha(data: FlowVerifyCaptcha): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.VERIFY_CAPTCHA}`;
    const payload = {
      flow_id: this.state.flowId,
      code: data.captchaCode,
    };

    return await this.post(path, payload);
  }

  async verifyEmail(data: FlowVerifyCallback): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.VERIFY_EMAIL}`;
    const payload = {
      flow_id: this.state.flowId,
      cb_code: data.cbCode,
      cb_state: data.cbState,
    };

    return await this.post(path, payload);
  }

  async enrollMfaStart(data: FlowMfaStart): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.ENROLL_MFA_START}`;
    const payload: any = {
      flow_id: this.state.flowId,
      mfa_provider: data.mfaProvider,
    };

    if (data.mfaProvider === "sms_otp" && data.phoneNumber) {
      payload.phone = data.phoneNumber;
    }

    const { success, response } = await this.post(path, payload);

    if (success) {
      if (response.result?.enroll_mfa_complete?.totp_secret?.qr_image) {
        this.state.qrCode =
          response.result.enroll_mfa_complete.totp_secret.qr_image;
      }

      this.state.step = response.result?.next_step;
    }

    return { success, response };
  }

  async enrollMfaComplete(data: FlowMfaComplete): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.ENROLL_MFA_COMPLETE}`;
    const payload = {
      flow_id: this.state.flowId,
      code: data.code,
      cancel: data.cancel,
    };

    return await this.post(path, payload);
  }

  async verifyMfaStart(data: FlowMfaStart): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.VERIFY_MFA_START}`;
    const payload = {
      flow_id: this.state.flowId,
      mfa_provider: data.mfaProvider,
    };

    return await this.post(path, payload);
  }

  async verifyMfaComplete(data: FlowMfaComplete): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.VERIFY_MFA_COMPLETE}`;
    const payload = {
      flow_id: this.state.flowId,
      code: data.code,
      cancel: data.cancel,
    };

    return await this.post(path, payload);
  }

  async complete(): Promise<ClientResponse> {
    const path = `${API_FLOW_BASE}/${FlowStep.COMPLETE}`;
    const payload = {
      flow_id: this.state.flowId,
    };

    return await this.post(path, payload);
  }

  // reset state to default
  reset() {
    this.state = {
      ...DEFAULT_FLOW_STATE,
    };
  }

  /*
    API Request functions
  */
  async post(
    endpoint: string,
    payload: any,
    updateState = true
  ): Promise<ClientResponse> {
    try {
      const response: AxiosResponse = await axios.post(
        this.getUrl(endpoint),
        payload,
        this.getOptions()
      );
      const success = this.processResponse(response.data, updateState);

      if (this.state.step === FlowStep.COMPLETE) {
        return await this.complete();
      } else if (this.state.step === FlowStep.VERIFY_MFA_START) {
        return await this.verifyMfaStart({
          mfaProvider: this.state.selectedMfa || "",
        });
      } else if (
        this.state.step === FlowStep.ENROLL_MFA_START &&
        this.state.selectedMfa !== "sms_otp"
      ) {
        return await this.enrollMfaStart({
          mfaProvider: this.state.selectedMfa || "",
        });
      }

      return { success, response: response.data };
    } catch (err) {
      return { success: false, response: this.getError(err) };
    }
  }

  processResponse(response: APIResponse, updateState = true): boolean {
    const success = response.status === "Success";

    // update state data if call was sucessful and updateState is true
    if (success && updateState) {
      // check for mfaProviders
      if (response.result?.verify_mfa_start?.mfa_providers) {
        this.state.mfaProviders =
          response.result?.verify_mfa_start?.mfa_providers === null
            ? []
            : [...response.result.verify_mfa_start.mfa_providers];
      } else if (response.result?.enroll_mfa_start?.mfa_providers) {
        this.state.mfaProviders =
          response.result?.enroll_mfa_start?.mfa_providers === null
            ? []
            : [...response.result.enroll_mfa_start.mfa_providers];
      }

      // set default mfa is none is set
      if (!this.state.selectedMfa && this.state.mfaProviders?.length) {
        this.state.selectedMfa = this.state.mfaProviders[0];
      }

      // set the next step
      this.state.step = response.result?.next_step;
    }

    return success;
  }
}

export default AuthNFlowClient;