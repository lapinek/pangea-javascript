import { Button, Stack, Typography } from "@mui/material";

import { useAuthFlow, FlowStep } from "@pangeacyber/react-auth";

const VerifyEmailView = () => {
  const { reset, loading, flowData, callNext } = useAuthFlow();

  const resendEmail = () => {
    callNext(FlowStep.VERIFY_EMAIL, {
      flowId: flowData.flowId,
      cb_state: null,
      cb_code: null,
    });
  };

  return (
    <Stack gap={2}>
      <Stack>
        <Typography variant="h6">Verify your email</Typography>
        <Typography variant="caption">{flowData.email}</Typography>
      </Stack>
      <Typography variant="body1">
        An email message has been sent to your inbox
      </Typography>
      <Stack direction="row" gap={2} mt={2}>
        <Button
          variant="contained"
          color="secondary"
          onClick={resendEmail}
          disabled={loading}
        >
          Resend Email
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={reset}
          sx={{ alignSelf: "flex-start" }}
        >
          Reset
        </Button>
      </Stack>
    </Stack>
  );
};

export default VerifyEmailView;
