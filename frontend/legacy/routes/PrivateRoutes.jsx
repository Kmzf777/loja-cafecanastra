import { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import authContext from "../contexts/loginContext/createAuthContext";
import Loading from "../components/Loading/Loading";

const PrivateRoutes = () => {
  const { user, initialized } = useContext(authContext);
  const location = useLocation();

  if (!initialized) {
    return <Loading />;
  }

  if (!user) {
    return <Navigate to="/account/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};

export default PrivateRoutes;
