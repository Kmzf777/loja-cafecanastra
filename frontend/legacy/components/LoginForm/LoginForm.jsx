import { useForm } from "react-hook-form";
import {
  LoginFormSection,
  DivInputError,
  InputContainer,
  Button,
  FormFooter,
  Form,
} from "./LoginForm.style";
import { HiOutlineMail } from "react-icons/hi";
import { TbLock } from "react-icons/tb";
import LogoShopnaw from "../../assets/logo_shop_naw_1124x1500.jpg";
import { Link, useNavigate, useLocation } from "react-router-dom";
import authContext from "../../contexts/loginContext/createAuthContext";
import { useContext, useState } from "react";
import { toast } from "react-toastify";
import { FaCheckCircle } from "react-icons/fa";
import { IoEyeOffOutline, IoEyeOutline } from "react-icons/io5";

function LoginForm() {
  const { loginUser } = useContext(authContext);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/site";

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting, isValid, dirtyFields },
  } = useForm({ mode: "onChange" });

  const emailValue = watch("emailLogin");
  const passwordValue = watch("passwordLogin");

  const isValidField = (name, value) =>
    dirtyFields[name] && !errors[name] && value;

  const onSubmit = async (data) => {
    try {
      const userData = {
        email: data.emailLogin,
        password: data.passwordLogin,
      };

      await loginUser(userData);

      toast.success("Login efetuado com sucesso!");

      reset();

      setTimeout(() => {
        navigate(from, { replace: true });
      }, 1500);
    } catch (error) {
      if (error.name === "AbortError") return;

      toast.error(error.message || "Erro ao fazer login.");

      console.error(error);
    }
  };

  return (
    <LoginFormSection>
      <img src={LogoShopnaw} alt="Logo Shopnaw" />

      <Form
        onSubmit={handleSubmit(onSubmit, (errors) => {
          const firstErrorField = Object.keys(errors)[0];
          if (firstErrorField) {
            const errorElement = document.getElementById(firstErrorField);
            if (errorElement) {
              errorElement.focus();
              errorElement.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
          }
        })}
        noValidate
      >
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.emailLogin}
            isValid={isValidField("emailLogin", emailValue)}
          >
            <HiOutlineMail className="icon" />
            <input
              type="email"
              name="emailLogin"
              id="emailLogin"
              placeholder="Email"
              autoComplete="username"
              {...register("emailLogin", {
                required: "Email é obrigatório.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Email inválido.",
                },
              })}
            />
            {isValidField("emailLogin", emailValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors?.emailLogin && (
            <p className="error-message">{errors.emailLogin.message}</p>
          )}
        </DivInputError>

        <DivInputError>
          <InputContainer
            isInvalid={!!errors.passwordLogin}
            isValid={isValidField("passwordLogin", passwordValue)}
          >
            <TbLock className="icon" />
            <input
              type={showPassword ? "text" : "password"}
              name="passwordLogin"
              id="passwordLogin"
              placeholder="Senha"
              autoComplete="current-password"
              {...register("passwordLogin", {
                required: "Senha é obrigatória.",
              })}
            />
            <span
              className="toggle-password"
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <IoEyeOffOutline /> : <IoEyeOutline />}
            </span>
            {isValidField("passwordLogin", passwordValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors?.passwordLogin && (
            <p className="error-message">{errors.passwordLogin.message}</p>
          )}
        </DivInputError>

        <span
          onClick={() => navigate("/account/forgot-password")}
          style={{
            fontSize: "13px",
            alignSelf: "end",
            marginTop: "-7px",
            marginRight: "40px",
            color: "#82858b",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          Esqueci minha senha
        </span>

        <Button type="submit" disabled={isSubmitting || !isValid}>
          {isSubmitting ? "Entrando..." : "Entrar"}
        </Button>

        <FormFooter>
          Ainda não tem uma conta?{" "}
          <Link to="/account/cadastro">Cadastre-se</Link>
        </FormFooter>
      </Form>
    </LoginFormSection>
  );
}

export default LoginForm;
