import { Suspense } from "react";
import Loading from "./components/Loading/Loading";

const Load = (Component) => (
  <Suspense fallback={<Loading />}>
    <Component />
  </Suspense>
);

export default Load;
