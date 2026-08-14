import { useState, useEffect, useContext } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";
import { API_BASE } from "../../api";
import Loading from "../../components/Loading/Loading";
import authContext from "../../contexts/loginContext/createAuthContext";
import {
  Container,
  FormBox,
  InputContainer,
  Button,
  DivInputError,
  PasswordRules,
} from "./ResetPassword.style";
import { TbLock } from "react-icons/tb";
import { FaCheckCircle } from "react-icons/fa";
import { IoEyeOffOutline, IoEyeOutline } from "react-icons/io5";

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [loading, setLoading] = useState(false);
  const { authFetch } = useContext(authContext);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [passwordRules, setPasswordRules] = useState({
    minLength: false,
    upperCase: false,
    lowerCase: false,
    number: false,
    specialChar: false,
  });

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isSubmitting, isValid, dirtyFields, touchedFields },
  } = useForm({ mode: "onChange" });

  const newPasswordValue = watch("newPassword");
  const confirmPasswordValue = watch("confirmPassword");

  const isValidField = (name, value) =>
    dirtyFields[name] && !errors[name] && value;

  useEffect(() => {
    if (!token) {
      toast.error("Token inválido ou ausente.");
      navigate("/account/login");
    }
  }, [token, navigate]);

  useEffect(() => {
    const pwd = newPasswordValue || "";
    setPasswordRules({
      minLength: pwd.length >= 8,
      upperCase: /[A-Z]/.test(pwd),
      lowerCase: /[a-z]/.test(pwd),
      number: /\d/.test(pwd),
      specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
    });
  }, [newPasswordValue]);

  useEffect(() => {
    if (touchedFields.confirmPassword) {
      trigger("confirmPassword");
    }
  }, [newPasswordValue, trigger, touchedFields]);

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: data.newPassword }),
      });

      const resData = await res.json();

      if (res.ok) {
        toast.success("Senha alterada com sucesso!");
        setTimeout(() => navigate("/account/login"), 2000);
      } else {
        if (resData.errors) {
          toast.error(resData.errors[0].message);
        } else {
          toast.error(resData.message || "Erro ao redefinir senha.");
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container>
      <FormBox onSubmit={handleSubmit(onSubmit)}>
        <h2>Criar Nova Senha</h2>

        <DivInputError>
          <InputContainer
            isInvalid={!!errors.newPassword}
            isValid={isValidField("newPassword", newPasswordValue)}
          >
            <TbLock className="icon" />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Nova senha"
              autoComplete="new-password"
              onFocus={() => setIsPasswordFocused(true)}
              onBlur={() => setIsPasswordFocused(false)}
              {...register("newPassword", {
                required: "A nova senha é obrigatória.",
                minLength: {
                  value: 8,
                  message: "Mínimo de 8 caracteres.",
                },
                validate: (value) => {
                  if (!/[A-Z]/.test(value)) return "Falta uma letra maiúscula.";
                  if (!/[a-z]/.test(value)) return "Falta uma letra minúscula.";
                  if (!/\d/.test(value)) return "Falta um número.";
                  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value))
                    return "Falta um caractere especial.";
                  return true;
                },
              })}
            />
            {/* Ícone de Olho */}
            <span
              className="toggle-password"
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <IoEyeOffOutline /> : <IoEyeOutline />}
            </span>
            {/* Ícone de Check Verde */}
            {isValidField("newPassword", newPasswordValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>

          {/* Mensagem de Erro Texto */}
          {errors.newPassword && (
            <p className="error-message">{errors.newPassword.message}</p>
          )}

          {/* Lista de Regras Visual */}
          {(isPasswordFocused || newPasswordValue) && (
            <PasswordRules>
              <li className={passwordRules.minLength ? "valid" : ""}>
                Mínimo de 8 caracteres
              </li>
              <li className={passwordRules.upperCase ? "valid" : ""}>
                Pelo menos uma letra maiúscula
              </li>
              <li className={passwordRules.lowerCase ? "valid" : ""}>
                Pelo menos uma letra minúscula
              </li>
              <li className={passwordRules.number ? "valid" : ""}>
                Pelo menos um número
              </li>
              <li className={passwordRules.specialChar ? "valid" : ""}>
                Pelo menos um caractere especial
              </li>
            </PasswordRules>
          )}
        </DivInputError>

        {/* --- CAMPO CONFIRMAR SENHA --- */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.confirmPassword}
            isValid={isValidField("confirmPassword", confirmPasswordValue)}
          >
            <TbLock className="icon" />
            <input
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirme a nova senha"
              autoComplete="new-password"
              {...register("confirmPassword", {
                required: "Confirmação de senha é obrigatória.",
                validate: (value) =>
                  value === newPasswordValue || "As senhas não coincidem.",
              })}
            />
            <span
              className="toggle-password"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
            >
              {showConfirmPassword ? <IoEyeOffOutline /> : <IoEyeOutline />}
            </span>
            {isValidField("confirmPassword", confirmPasswordValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors.confirmPassword && (
            <p className="error-message">{errors.confirmPassword.message}</p>
          )}
        </DivInputError>

        <Button
          type="submit"
          disabled={isSubmitting || !isValid || loading}
          style={{ maxWidth: "100%" }}
        >
          {loading || isSubmitting ? "Salvando..." : "Redefinir Senha"}
        </Button>
      </FormBox>

      {loading && <Loading />}
    </Container>
  );
}

export default ResetPassword;
