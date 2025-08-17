import {
  useState,
  useCallback,
  useRef,
} from "react";
import { useLocalization } from "./useLocalization";
import type { WikiArticle } from "../components/WikiCard";

// Type definitions for Wikipedia API responses
interface WikiCategoryMember {
  pageid: number;
  ns: number;
  title: string;
}

interface WikiCategoryResponse {
  query?: {
    categorymembers?: WikiCategoryMember[];
  };
}

interface WikiThumbnail {
  source: string;
  width: number;
  height: number;
}

interface WikiCategory {
  ns: number;
  title: string;
}

interface WikiPage {
  pageid: number;
  ns: number;
  title: string;
  extract?: string;
  thumbnail?: WikiThumbnail;
  canonicalurl?: string;
  varianttitles?: Record<string, string>;
  categories?: WikiCategory[];
}

interface WikiPagesResponse {
  query: {
    pages: Record<string, WikiPage>;
  };
}

const preloadImage = (
  src: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve();
    img.onerror = reject;
  });
};

export function useWikiArticles() {
  const [articles, setArticles] = useState<
    WikiArticle[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [buffer, setBuffer] = useState<
    WikiArticle[]
  >([]);
  const { currentLanguage } = useLocalization();
  
  // Use ref to store the latest fetchArticles function
  const fetchArticlesRef = useRef<(forBuffer?: boolean) => Promise<void>>(() => Promise.resolve());

  const getWeightedFilmYear = () => {
    const currentYear = new Date().getFullYear();
    const startYear = 1929; // First Oscar year
    const random = Math.random();
    // Exponential decay with preference for recent years
    return Math.floor(
      currentYear -
        Math.pow(random, 0.5) *
          (currentYear - startYear)
    );
  };

  const fetchFilmsForYear = async (
    year: number
  ) => {
    try {
      const response = await fetch(
        currentLanguage.api +
          new URLSearchParams({
            action: "query",
            format: "json",
            list: "categorymembers",
            cmtitle: `Category:${year} films`,
            cmnamespace: "0",
            cmlimit: "200",
            origin: "*",
          })
      );
      const data: WikiCategoryResponse = await response.json();
      return data.query?.categorymembers || [];
    } catch (error) {
      console.error(
        `Error fetching films for ${year}:`,
        error
      );
      return [];
    }
  };

  // Fallback method using random generator with film-related filtering
  const fetchRandomFilmsWithFilter = async (
    forBuffer = false
  ) => {
    try {
      const response = await fetch(
        currentLanguage.api +
          new URLSearchParams({
            action: "query",
            format: "json",
            generator: "random",
            grnnamespace: "0",
            prop: "extracts|info|pageimages|categories",
            inprop: "url|varianttitles",
            grnlimit: "50",
            exintro: "1",
            exlimit: "max",
            exsentences: "5",
            explaintext: "1",
            piprop: "thumbnail",
            pithumbsize: "800",
            cllimit: "50",
            origin: "*",
            variant: currentLanguage.id,
          })
      );

      const data: WikiPagesResponse = await response.json();

      const filmArticles = Object.values(
        data.query.pages
      )
        .filter((page: WikiPage) => {
          const isFilm =
            page.categories?.some(
              (cat: WikiCategory) =>
                cat.title
                  .toLowerCase()
                  .includes("film") ||
                cat.title
                  .toLowerCase()
                  .includes("movie") ||
                cat.title
                  .toLowerCase()
                  .includes("cinema")
            ) ||
            page.title
              .toLowerCase()
              .includes("film") ||
            page.extract
              ?.toLowerCase()
              .includes("film") ||
            page.extract
              ?.toLowerCase()
              .includes("movie") ||
            page.extract
              ?.toLowerCase()
              .includes("directed by") ||
            page.extract
              ?.toLowerCase()
              .includes("starring");

          return (
            isFilm &&
            page.thumbnail &&
            page.thumbnail.source &&
            page.canonicalurl &&
            page.extract &&
            page.extract.length > 100
          );
        })
        .map(
          (page: WikiPage): WikiArticle => ({
            title: page.title,
            displaytitle:
              page.varianttitles?.[
                currentLanguage.id
              ] || page.title,
            extract: page.extract!,
            pageid: page.pageid.toString(),
            thumbnail: page.thumbnail!,
            url: page.canonicalurl!,
            categories: page.categories?.map(cat => cat.title) || [],
          })
        )
        .slice(0, 20);

      await Promise.allSettled(
        filmArticles
          .filter((article) => article.thumbnail)
          .map((article) =>
            preloadImage(
              article.thumbnail!.source
            )
          )
      );

      if (forBuffer) {
        setBuffer(filmArticles);
      } else {
        setArticles((prev) => [
          ...prev,
          ...filmArticles,
        ]);
        fetchArticlesRef.current?.(true);
      }
    } catch (error) {
      console.error(
        "Error in fallback film fetch:",
        error
      );
    }
  };

  const fetchArticles = async (
    forBuffer = false
  ) => {
    if (loading) return;
    setLoading(true);

    try {
      const yearPromises = [];
      for (let i = 0; i < 5; i++) {
        const randomYear = getWeightedFilmYear();
        yearPromises.push(
          fetchFilmsForYear(randomYear)
        );
      }

      const yearResults = await Promise.all(
        yearPromises
      );
      const allFilms = yearResults.flat();

      // Randomly select 20 films from all collected films
      const shuffled = [...allFilms].sort(
        () => Math.random() - 0.5
      );
      const selectedTitles = shuffled
        .slice(0, 20)
        .map((film: WikiCategoryMember) => film.title);

      const detailsResponse = await fetch(
        currentLanguage.api +
          new URLSearchParams({
            action: "query",
            format: "json",
            titles: selectedTitles.join("|"),
            prop: "extracts|info|pageimages",
            inprop: "url|varianttitles",
            exintro: "1",
            exlimit: "max",
            exsentences: "5",
            explaintext: "1",
            piprop: "thumbnail",
            pithumbsize: "800",
            origin: "*",
            variant: currentLanguage.id,
          })
      );

      const detailsData: WikiPagesResponse =
        await detailsResponse.json();

      const newArticles = Object.values(
        detailsData.query.pages
      )
        .filter(
          (page: WikiPage) =>
            page.thumbnail &&
            page.thumbnail.source &&
            page.canonicalurl &&
            page.extract &&
            page.extract.length > 100 // Ensure substantial content
        )
        .map(
          (page: WikiPage): WikiArticle => ({
            title: page.title,
            displaytitle:
              page.varianttitles?.[
                currentLanguage.id
              ] || page.title,
            extract: page.extract!,
            pageid: page.pageid.toString(),
            thumbnail: page.thumbnail!,
            url: page.canonicalurl!,
          })
        );

      // Preload images
      await Promise.allSettled(
        newArticles
          .filter((article) => article.thumbnail)
          .map((article) =>
            preloadImage(
              article.thumbnail!.source
            )
          )
      );

      if (forBuffer) {
        setBuffer(newArticles);
      } else {
        setArticles((prev) => [
          ...prev,
          ...newArticles,
        ]);
        fetchArticles(true);
      }
    } catch (error) {
      console.error(
        "Error fetching film articles:",
        error
      );
      await fetchRandomFilmsWithFilter(forBuffer);
    }

    setLoading(false);
  };

  // Update the ref whenever fetchArticles changes
  fetchArticlesRef.current = fetchArticles;

  const getMoreArticles = useCallback(() => {
    if (buffer.length > 0) {
      setArticles((prev) => [...prev, ...buffer]);
      setBuffer([]);
      fetchArticlesRef.current?.(true);
    } else {
      fetchArticlesRef.current?.(false);
    }
  }, [buffer]);

  return {
    articles,
    loading,
    fetchArticles: getMoreArticles,
  };
}