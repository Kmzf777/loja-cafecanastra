import { useSearchParams } from "react-router-dom";
import NewShirstSection from "../../components/NewShirtsSection/NewShirtsSection";
import FilterShirts from "../../components/filterShirts/FilterShirts";
import BranchShirtsSection from "../../components/BranchShirtSection/BranchShirtsSection";
import { useContext, useEffect } from "react";
import productContext from "../../contexts/productContext/createProductContext";
import Banner from "../../components/BannerSite/Banner";
import SearchProduct from "../../components/SearchProduct/SearchProduct";

function Site() {
  const [searchParams, setSearchParams] = useSearchParams();
  let queryParams = new URLSearchParams(searchParams);
  const { updateProductList, setValue, setOldPage } =
    useContext(productContext);

  useEffect(() => {
    setValue(0);
  }, [setValue]);

  useEffect(() => {
    const p = parseInt(searchParams.get("page")) || 1;
    setOldPage(p);

    if (!searchParams.get("page")) {
      const params = new URLSearchParams(searchParams);
      params.set("page", "1");
      setSearchParams(params);
    }
  }, [searchParams, setSearchParams, setOldPage]);

  useEffect(() => {
    const cleanParams = new URLSearchParams(searchParams);

    if (cleanParams.has("category") || cleanParams.has("size")) {
      cleanParams.delete("gsearch");
    } else if (cleanParams.has("gsearch")) {
      cleanParams.delete("category");
      cleanParams.delete("size");
    }

    if (cleanParams.toString() !== searchParams.toString()) {
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${cleanParams}`,
      );
    }

    if (cleanParams.size === 0) {
      updateProductList();
    }
  }, [searchParams, updateProductList]);

  return (
    <>
      <Banner />

      {queryParams.toString().includes("category") ||
      queryParams.toString().includes("size") ? (
        <FilterShirts />
      ) : (
        <>
          {queryParams.toString().includes("gsearch") ? (
            <SearchProduct />
          ) : (
            <>
              {parseInt(searchParams.get("page")) == 1 && <NewShirstSection />}
              <BranchShirtsSection />
            </>
          )}
        </>
      )}
    </>
  );
}

export default Site;
