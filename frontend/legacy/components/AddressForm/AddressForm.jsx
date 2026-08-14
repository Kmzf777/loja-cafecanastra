import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { useForm } from "react-hook-form";
import { API_BASE } from "../../api";
import PropTypes from "prop-types";
import Loading from "../Loading/Loading";

const FormContainer = styled.form`
  display: flex;
  flex-direction: column;
  gap: 15px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
  width: 100%;
  flex: 1;
  height: 430px;

  h3 {
    margin-bottom: 10px;
    color: #333;
  }

  .row {
    display: flex;
    gap: 15px;
    @media (max-width: 600px) {
      flex-direction: column;
      gap: 10px;
    }
  }

  input {
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 5px;
    width: 100%;
    font-size: 1rem;
    &:focus {
      outline: 1px solid #82858b;
      border-color: #82858b;
    }
  }

  label {
    font-size: 0.9rem;
    color: #666;
    margin-bottom: 3px;
    display: block;
  }

  .error {
    color: red;
    font-size: 0.8rem;
    margin-top: 2px;
  }

  button.save-btn {
    background-color: #82858b;
    color: white;
    padding: 12px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-weight: bold;
    margin-top: 10px;
    &:hover {
      background-color: #555;
    }
    &:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
  }
`;

const AddressForm = ({ onAddressSaved, authFetch, initialZip }) => {
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm();

  const fetchCepData = useCallback(
    async (cepValue, keepNumber = false) => {
      const cep = cepValue.replace(/\D/g, "");
      if (cep.length !== 8) return;

      setLoading(true);
      clearErrors("zipCode");

      try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await res.json();

        if (!data.erro) {
          setValue("street", data.logradouro);
          setValue("neighborhood", data.bairro);
          setValue("city", data.localidade);
          setValue("state", data.uf);

          if (!keepNumber) {
            setValue("number", "");
            setValue("complement", "");
            setFocus("number");
          }

          clearErrors("zipCode");
        } else {
          setError("zipCode", {
            type: "manual",
            message: "CEP não encontrado.",
          });
          if (!keepNumber) {
            setValue("street", "");
            setValue("neighborhood", "");
            setValue("city", "");
            setValue("state", "");
          }
        }
      } catch (err) {
        console.error(err);
        setError("zipCode", { type: "manual", message: "Erro ao buscar CEP." });
      } finally {
        setLoading(false);
      }
    },
    [clearErrors, setError, setFocus, setValue]
  );

  useEffect(() => {
    const loadAddress = async () => {
      try {
        const res = await authFetch(`${API_BASE}/address`);
        let dbAddress = null;

        if (res.ok) {
          const data = await res.json();
          if (data.zip_code) {
            dbAddress = data;
          }
        }

        const cartZipClean = initialZip ? initialZip.replace(/\D/g, "") : "";
        const dbZipClean = dbAddress
          ? dbAddress.zip_code.replace(/\D/g, "")
          : "";

        if (cartZipClean && cartZipClean !== dbZipClean) {
          // CASO A: Usuário mudou o CEP no Carrinho (Intenção mais recente)
          // Preenche o CEP, busca no ViaCEP e força o usuário a digitar o número novo
          setValue("zipCode", initialZip);
          fetchCepData(initialZip, false);
        } else if (dbAddress) {
          // CASO B: CEP do Carrinho é igual ao do Banco OU não tem CEP no carrinho
          // Usa os dados completos do banco (incluindo número e complemento)
          setValue("zipCode", dbAddress.zip_code);
          setValue("street", dbAddress.street);
          setValue("neighborhood", dbAddress.neighborhood);
          setValue("city", dbAddress.city);
          setValue("state", dbAddress.state);
          setValue("number", dbAddress.number);
          setValue("complement", dbAddress.complement);

          onAddressSaved(dbAddress);
        } else if (cartZipClean) {
          // CASO C: Não tem endereço no banco, mas tem no carrinho (Usuário novo)
          setValue("zipCode", initialZip);
          fetchCepData(initialZip, false);
        }
      } catch (err) {
        console.error("Erro ao carregar endereço inicial:", err);
      }
    };
    loadAddress();
  }, [authFetch, initialZip, setValue, onAddressSaved, fetchCepData]);

  const checkCEP = async (e) => {
    fetchCepData(e.target.value, false);
  };

  const onSubmit = async (data) => {
    try {
      const res = await authFetch(`${API_BASE}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        const saved = await res.json();
        onAddressSaved(saved);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <FormContainer onSubmit={handleSubmit(onSubmit)}>
      {loading && <Loading />}
      <h3>Endereço de Entrega</h3>

      <div>
        <label>CEP</label>
        <input
          {...register("zipCode", {
            required: "CEP obrigatório",
            minLength: 8,
          })}
          onBlur={checkCEP}
          placeholder="00000-000"
          maxLength={8}
        />
        {errors.zipCode && (
          <span className="error">{errors.zipCode.message}</span>
        )}
      </div>

      <div className="row">
        <div style={{ flex: 3 }}>
          <label>Rua</label>
          <input
            {...register("street", { required: "Rua obrigatória" })}
            placeholder="Nome da rua"
          />
          {errors.street && (
            <span className="error">{errors.street.message}</span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label>Número</label>
          <input
            {...register("number", { required: "Número obrigatório" })}
            placeholder="123"
          />
          {errors.number && (
            <span className="error">{errors.number.message}</span>
          )}
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Complemento</label>
          <input {...register("complement")} placeholder="Apto, Bloco..." />
        </div>
        <div style={{ flex: 1 }}>
          <label>Bairro</label>
          <input {...register("neighborhood", { required: "Obrigatório" })} />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 3 }}>
          <label>Cidade</label>
          <input {...register("city", { required: "Obrigatório" })} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Estado</label>
          <input
            {...register("state", { required: "UF", maxLength: 2 })}
            maxLength={2}
          />
        </div>
      </div>

      <button type="submit" className="save-btn" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Confirmar Endereço"}
      </button>
    </FormContainer>
  );
};

export default AddressForm;

AddressForm.propTypes = {
  onAddressSaved: PropTypes.func,
  authFetch: PropTypes.func,
  initialZip: PropTypes.string,
};
