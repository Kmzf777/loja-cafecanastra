import { useEffect, useState } from "react";
import { SearchBarContent, SearchBarInput } from "./SearchBar.style";
import { IoSearchOutline } from "react-icons/io5";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

function SearchBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const [searchParams] = useSearchParams();
  const searchResult = searchParams.get("gsearch");

  const hiddenRoutes = ["/politica-de-privacidade", "/termos-de-uso"];
  const shouldShowSearchBar = !hiddenRoutes.includes(location.pathname);

  useEffect(() => {
    if (searchResult) {
      setSearchValue(decodeURIComponent(searchResult));
    } else {
      setSearchValue("");
    }
  }, [searchResult]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const q = searchValue.trim();
    if (!q) return;
    //setSearchParams({ gsearch: q, page: "1" });

    navigate(`/site?gsearch=${encodeURIComponent(q)}`);
  };

  if (!shouldShowSearchBar) return null;

  return (
    <SearchBarContent as="form" onSubmit={handleSubmit}>
      <SearchBarInput
        type="search"
        placeholder="Pesquisar"
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
      />
      <button
        disabled={searchValue.trim() === ""}
        type="submit"
        style={{ background: "none", border: "none" }}
      >
        <IoSearchOutline className="searchIcon" />
      </button>
    </SearchBarContent>
  );
}

export default SearchBar;
