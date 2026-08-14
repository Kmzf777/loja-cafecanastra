import { useContext, useEffect, useState } from "react";
import {
  BackgroundOption,
  Categories,
  FilterDropdown,
  FilterDropdownDivInputs,
  MenuSection,
} from "./Menu.style";
import productContext from "../../../contexts/productContext/createProductContext";
import { useHref, useSearchParams } from "react-router-dom";
import { Option } from "../sidebar/Sidebar.style";
import { IoFilter } from "react-icons/io5";
import fetchDataForm from "../../../api";

function Menu() {
  const href = useHref();
  const isEqual = href == "/site";

  const [categories, setCategories] = useState([]);
  const [sizes, setSizes] = useState([]);

  const { updateProductList } = useContext(productContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  let queryParams = new URLSearchParams(searchParams);

  const fetchOptions = async () => {
    try {
      const [catRes, sizeRes] = await Promise.all([
        fetchDataForm("/options?type=category", "GET"),
        fetchDataForm("/options?type=size", "GET"),
      ]);
      const categoriesData = await catRes.json();
      const sizesData = await sizeRes.json();

      setCategories(categoriesData);
      setSizes(sizesData);
    } catch (error) {
      console.error("Erro ao carregar categorias ou tamanhos", error);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, []);

  const handleClickFilter = async (e, category) => {
    if (e.target.classList.contains("category")) {
      queryParams.set("category", category);
    }

    queryParams.set("page", "1");
    setSearchParams(queryParams.toString());
    updateProductList(queryParams.toString());
  };

  const handleChange = (e) => {
    if (e.target.checked) {
      queryParams.set("size", e.target.id);
    } else {
      queryParams.delete("size");
    }

    queryParams.set("page", "1");
    setSearchParams(queryParams.toString());
    updateProductList(queryParams.toString());
  };

  const clearFilters = () => {
    queryParams.set("page", "1");
    setSearchParams("");
    updateProductList("");
  };

  return (
    <>
      {isEqual && (
        <MenuSection>
          <Categories>
            <BackgroundOption onClick={() => setIsFilterOpen(!isFilterOpen)}>
              <Option
                style={{
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <IoFilter /> Filtrar
              </Option>
            </BackgroundOption>

            {isFilterOpen && (
              <FilterDropdown
                className="open"
                onMouseLeave={() => setIsFilterOpen(false)}
              >
                {sizes.map((size) => {
                  return (
                    <FilterDropdownDivInputs key={size.id}>
                      <label htmlFor={size.value}>Tamanho {size.value}</label>
                      <input
                        type="checkbox"
                        id={size.value}
                        checked={searchParams.get("size") === size.value}
                        onChange={handleChange}
                      />
                    </FilterDropdownDivInputs>
                  );
                })}
              </FilterDropdown>
            )}

            {categories.map((category) => {
              return (
                <BackgroundOption
                  key={category.id}
                  style={{
                    borderColor:
                      searchParams.get("category") === category.value
                        ? "#000"
                        : "transparent",
                  }}
                >
                  <Option
                    className="category"
                    style={{
                      color: "#fff",
                    }}
                    onClick={(e) => handleClickFilter(e, category.value)}
                  >
                    {category.value}
                  </Option>
                </BackgroundOption>
              );
            })}

            {(searchParams.get("category") || searchParams.get("size")) && (
              <BackgroundOption
                style={{
                  backgroundColor: "#f3f3f3",
                  marginLeft: 16,
                  borderColor: "transparent",
                }}
                onClick={clearFilters}
              >
                <Option id="clear-filters">Limpar Filtros</Option>
              </BackgroundOption>
            )}
          </Categories>
        </MenuSection>
      )}
    </>
  );
}

export default Menu;
