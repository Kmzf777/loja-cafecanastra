import { useForm, Controller } from "react-hook-form";
import { useContext, useEffect, useState } from "react";
import {
  DivInputError,
  InputContainer,
  Button,
  FormFooter,
  Form,
} from "../LoginForm/LoginForm.style";
import { HiOutlineMail } from "react-icons/hi";
import { TbLock } from "react-icons/tb";
import { MdDriveFileRenameOutline } from "react-icons/md";
import { FaPhone, FaCheckCircle } from "react-icons/fa";
import {
  CheckboxContainer,
  PasswordRules,
  SignUpFormSection,
} from "./SignUpForm.style";
import LogoShopnaw from "../../assets/logo_shop_naw_1124x1500.jpg";
import { toast } from "react-toastify";
import authContext from "../../contexts/loginContext/createAuthContext";
import { Link, useNavigate } from "react-router-dom";
import { IoEyeOffOutline, IoEyeOutline } from "react-icons/io5";
import { IMaskInput } from "react-imask";

function SignUpForm() {
  const { createUser } = useContext(authContext);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordRules, setPasswordRules] = useState({
    minLength: false,
    upperCase: false,
    lowerCase: false,
    number: false,
    specialChar: false,
  });
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setError,
    trigger,
    formState: { errors, isSubmitting, isValid, dirtyFields, touchedFields },
  } = useForm({ mode: "onChange" });

  const password = watch("password");
  const nameValue = watch("name");
  const phoneValue = watch("phone");
  const emailValue = watch("email");
  const cpfValue = watch("cpf");
  const confirmPasswordValue = watch("confirmPassword");

  const isValidField = (name, value) =>
    dirtyFields[name] && !errors[name] && value;

  useEffect(() => {
    setPasswordRules({
      minLength: password?.length >= 8,
      upperCase: /[A-Z]/.test(password),
      lowerCase: /[a-z]/.test(password),
      number: /\d/.test(password),
      specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    });
  }, [password]);

  const validateCPF = (cpf) => {
    if (!cpf) return false;
    const cleanCpf = cpf.replace(/[^\d]+/g, ""); // Remove pontos e traços
    if (cleanCpf.length !== 11 || /^(\d)\1{10}$/.test(cleanCpf)) return false;

    let soma = 0;
    let resto;
    for (let i = 1; i <= 9; i++)
      soma = soma + parseInt(cleanCpf.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cleanCpf.substring(9, 10))) return false;

    soma = 0;
    for (let i = 1; i <= 10; i++)
      soma = soma + parseInt(cleanCpf.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cleanCpf.substring(10, 11))) return false;

    return true;
  };

  useEffect(() => {
    if (touchedFields.confirmPassword) {
      trigger("confirmPassword");
    }
  }, [password, trigger, touchedFields]);

  const onSubmit = async (data) => {
    const userData = {
      name: data.name,
      cpf: data.cpf,
      phone: data.phone,
      email: data.email,
      password: data.password,
    };

    try {
      const response = await createUser(userData);
      const resData = await response.json();

      if (response.ok) {
        toast.success(
          resData.message || "Cadastro realizado! Verifique seu e-mail.",
        );

        reset();
        setTimeout(() => {
          navigate("/account/login", { replace: true });
        }, 2500);
      } else {
        if (resData.errors) {
          resData.errors.forEach((err) => {
            setError(err.field, { type: "server", message: err.message });
          });
        }

        toast.error(resData.message || "Erro ao cadastrar.");
      }
    } catch (error) {
      toast.error("Erro ao cadastrar. Verifique os dados ou tente novamente.");
      console.error(error);
    }
  };

  return (
    <SignUpFormSection>
      <img src={LogoShopnaw} alt="Logo Shopnaw" />

      <Form
        noValidate
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
      >
        {/* Nome */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.name}
            isValid={isValidField("name", nameValue)}
          >
            <MdDriveFileRenameOutline className="icon" />
            <input
              type="text"
              id="name"
              aria-invalid={!!errors.name}
              placeholder="Nome completo"
              autoComplete="name"
              {...register("name", {
                required: "Nome é obrigatório.",
                minLength: {
                  value: 2,
                  message: "Nome deve conter pelo menos 2 caracteres.",
                },
              })}
            />
            {isValidField("name", nameValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors.name && (
            <p className="error-message">{errors.name.message}</p>
          )}
        </DivInputError>

        {/* CPF */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.cpf}
            isValid={isValidField("cpf", cpfValue)}
          >
            <FaPhone className="icon" />
            <Controller
              name="cpf"
              control={control}
              defaultValue=""
              rules={{
                required: "CPF é obrigatório.",
                validate: (value) =>
                  validateCPF(value) || "Digite um CPF válido.",
              }}
              render={({ field }) => (
                <IMaskInput
                  {...field}
                  mask="000.000.000-00"
                  unmask={false} // retorna máscara no value, altere para true se quiser só números
                  placeholder="000.000.000-00"
                  id="cpf"
                  type="text"
                  autoComplete="cpf"
                  onAccept={(value) => field.onChange(value)} // atualiza react-hook-form
                  onBlur={field.onBlur}
                  value={field.value}
                />
              )}
            />
            {isValidField("cpf", cpfValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors.cpf && <p className="error-message">{errors.cpf.message}</p>}
        </DivInputError>

        {/* Telefone */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.phone}
            isValid={isValidField("phone", phoneValue)}
          >
            <FaPhone className="icon" />
            <Controller
              name="phone"
              control={control}
              defaultValue=""
              rules={{ required: "Telefone é obrigatório." }}
              render={({ field }) => (
                <IMaskInput
                  {...field}
                  mask="(00) 00000-0000"
                  unmask={false} // retorna máscara no value, altere para true se quiser só números
                  placeholder="(99) 99999-9999"
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  onAccept={(value) => field.onChange(value)} // atualiza react-hook-form
                  onBlur={field.onBlur}
                  value={field.value}
                />
              )}
            />
            {isValidField("phone", phoneValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors.phone && (
            <p className="error-message">{errors.phone.message}</p>
          )}
        </DivInputError>

        {/* Email */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.email}
            isValid={isValidField("email", emailValue)}
          >
            <HiOutlineMail className="icon" />
            <input
              type="email"
              id="email"
              aria-invalid={!!errors.email}
              placeholder="Email"
              autoComplete="username"
              {...register("email", {
                required: "Email é obrigatório.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Email inválido.",
                },
              })}
            />
            {isValidField("email", emailValue) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors.email && (
            <p className="error-message">{errors.email.message}</p>
          )}
        </DivInputError>

        {/* Senha */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.password}
            isValid={isValidField("password", password)}
          >
            <TbLock className="icon" />
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              aria-invalid={!!errors.password}
              placeholder="Senha"
              autoComplete="new-password"
              onFocus={() => setIsPasswordFocused(true)}
              onBlur={() => setIsPasswordFocused(false)}
              {...register("password", {
                required: "Senha é obrigatória.",
                minLength: {
                  value: 8,
                  message: "Mínimo de 8 caracteres.",
                },
                validate: (value) => {
                  if (!/[A-Z]/.test(value))
                    return "Deve conter pelo menos uma letra maiúscula.";
                  if (!/[a-z]/.test(value))
                    return "Deve conter pelo menos uma letra minúscula.";
                  if (!/\d/.test(value))
                    return "Deve conter pelo menos um número.";
                  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value))
                    return "Deve conter pelo menos um caractere especial.";
                  return true;
                },
              })}
            />
            <span
              className="toggle-password"
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <IoEyeOffOutline /> : <IoEyeOutline />}
            </span>
            {isValidField("password", password) && (
              <FaCheckCircle className="check-icon" />
            )}
          </InputContainer>
          {errors.password && (
            <p className="error-message">{errors.password.message}</p>
          )}

          {isPasswordFocused && (
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

        {/* Confirmar senha */}
        <DivInputError>
          <InputContainer
            isInvalid={!!errors.confirmPassword}
            isValid={isValidField("confirmPassword", confirmPasswordValue)}
          >
            <TbLock className="icon" />
            <input
              type={showConfirmPassword ? "text" : "password"}
              id="confirmPassword"
              aria-invalid={!!errors.confirmPassword}
              placeholder="Confirme a senha"
              autoComplete="new-password"
              {...register("confirmPassword", {
                required: "Confirmação de senha é obrigatória.",
                validate: {
                  matchesPassword: (value) =>
                    value === password || "As senhas não coincidem.",
                },
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

        <DivInputError>
          <CheckboxContainer>
            <input
              type="checkbox"
              id="terms"
              {...register("terms", {
                required: "Você precisa aceitar os termos para continuar.",
              })}
            />
            <label htmlFor="terms">
              Li e concordo com os{" "}
              <Link to="/termos-de-uso" target="_blank">
                Termos de Uso
              </Link>{" "}
              e a{" "}
              <Link to="/politica-de-privacidade" target="_blank">
                Política de Privacidade
              </Link>
              .
            </label>
          </CheckboxContainer>
          {errors.terms && (
            <p
              className="error-message"
              style={{ marginTop: "-10px", marginBottom: "15px" }}
            >
              {errors.terms.message}
            </p>
          )}
        </DivInputError>

        <Button type="submit" disabled={isSubmitting || !isValid}>
          {isSubmitting ? "Cadastrando..." : "Cadastrar"}
        </Button>

        <FormFooter>
          Já tem uma conta? <Link to="/account/login">Faça login</Link>
        </FormFooter>
      </Form>
    </SignUpFormSection>
  );
}

export default SignUpForm;
