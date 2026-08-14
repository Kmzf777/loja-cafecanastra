import { useContext } from "react";
import { Navigate, Outlet } from "react-router-dom";
import authContext from "../contexts/loginContext/createAuthContext";
import Loading from "../components/Loading/Loading";

const AdminRoutes = () => {
  const { user, initialized } = useContext(authContext);

  if (!initialized) {
    return <Loading />;
  }

  if (!user) {
    return <Navigate to="/account/login" replace />;
  }

  if (user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default AdminRoutes;
