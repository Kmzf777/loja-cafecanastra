import { BannerContainer } from "./Banner.style";
import BannerTestDesktop from "../../assets/bannerdesktop.jpg";
import BannerTestMobile from "../../assets/bannermobile.jpg";
import { useEffect, useState } from "react";
import { API_BASE } from "../../api";

function Banner() {
  const [bannerUrl, setBannerUrl] = useState({ desktop: null, mobile: null });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then((data) => {
        const resolveUrl = (path) => {
          if (!path) return null;
          return path.startsWith("http") ? path : `${API_BASE}${path}`;
        };

        setBannerUrl({
          desktop: resolveUrl(data.banner_desktop),
          mobile: resolveUrl(data.banner_mobile),
        });
      })
      .catch((err) => console.error("Erro ao carregar banner", err))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <div className="skeleton-banner"></div>;

  const desktopSrc = bannerUrl.desktop || BannerTestDesktop;
  const mobileSrc = bannerUrl.mobile || BannerTestMobile;

  return (
    <BannerContainer>
      <picture>
        <source media="(max-width: 768px)" srcSet={mobileSrc} />
        <img src={desktopSrc} alt="Banner" />
      </picture>
    </BannerContainer>
  );
}

export default Banner;
