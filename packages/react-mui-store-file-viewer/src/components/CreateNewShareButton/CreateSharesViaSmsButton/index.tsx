import { Button, ButtonProps } from "@mui/material";
import { FC, useMemo, useState } from "react";
import pickBy from "lodash/pickBy";

import LocalPhoneIcon from "@mui/icons-material/LocalPhone";

import {
  FieldsForm,
  FieldsFormSchema,
  PangeaModal,
} from "@pangeacyber/react-mui-shared";
import { ObjectStore } from "../../../types";
import { useStoreFileViewerContext } from "../../../hooks/context";
import { CreatePhoneShareFields } from "./fields";

interface Props {
  object: ObjectStore.ObjectResponse;
  ButtonProps?: ButtonProps;
  onClose: () => void;
  onDone: () => void;
}

const CreateSharesViaSmsButton: FC<Props> = ({
  object,
  ButtonProps,
  onClose,
  onDone,
}) => {
  const { apiRef } = useStoreFileViewerContext();
  const [open, setOpen] = useState(false);

  const [loading, setLoading] = useState(false);

  const obj = useMemo<ObjectStore.SingleShareCreateRequest>(() => {
    var date = new Date();
    date.setDate(date.getDate() + 7);

    return {
      targets: [],
      authenticators: [],
      link_type: "download",
      expires_at: date.toISOString(),
      max_access_count: 10,
    };
  }, []);

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleCreateShare = async (
    body: ObjectStore.SingleShareCreateRequest
  ) => {
    if (!apiRef.share?.create) return;

    setLoading(true);
    if (!apiRef.share?.create) return;
    return apiRef.share
      .create({
        links: (body?.authenticators ?? [])?.map((auth) => {
          return {
            ...body,
            targets: [object.id],
            authenticators: [auth],
          };
        }),
      })
      .finally(() => {
        setLoading(false);
        onDone();
      });
  };

  const fields = useMemo<
    FieldsFormSchema<ObjectStore.SingleShareCreateRequest>
  >(() => {
    return CreatePhoneShareFields;
  }, []);

  return (
    <>
      <Button
        variant="text"
        {...ButtonProps}
        startIcon={<LocalPhoneIcon fontSize="small" />}
        onClick={() => setOpen(true)}
      >
        Secure with Phone Number
      </Button>
      <PangeaModal
        open={open}
        onClose={handleClose}
        title={"Secure Share Links with Phone Number"}
        size="medium"
      >
        <FieldsForm
          object={obj}
          fields={fields}
          onSubmit={(values) => {
            // @ts-ignore
            return handleCreateShare(
              pickBy(values, (v, k) => !!v && k !== "phones")
            )
              .then(() => {})
              .finally(handleClose);
          }}
          disabled={loading}
        />
      </PangeaModal>
    </>
  );
};

export default CreateSharesViaSmsButton;
