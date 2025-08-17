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
    // Add timeout to prevent hanging
    setTimeout(() => reject(new Error('Image load timeout')), 5000);
  });
};

// Helper function to deduplicate articles by pageid
const deduplicateArticles = (articles: WikiArticle[]): WikiArticle[] => {
  const seen = new Set<string>();
  return articles.filter(article => {
    if (seen.has(article.pageid)) {
      return false;
    }
    seen.add(article.pageid);
    return true;
  });
};

// Helper function to merge new articles with existing ones, avoiding duplicates
const mergeUniqueArticles = (existing: WikiArticle[], newArticles: WikiArticle[]): WikiArticle[] => {
  const existingIds = new Set(existing.map(article => article.pageid));
  const uniqueNewArticles = newArticles.filter(article => !existingIds.has(article.pageid));
  return [...existing, ...uniqueNewArticles];
};

export function useWikiArticles() {
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [buffer, setBuffer] = useState<WikiArticle[]>([]);
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: WikiCategoryResponse = await response.json();
      return data.query?.categorymembers || [];
    } catch (error) {
      console.error(`Error fetching films for ${year}:`, error);
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: WikiPagesResponse = await response.json();

      const filmArticles = Object.values(data.query.pages)
        .filter((page: WikiPage) => {
          const isFilm =
            page.categories?.some(
              (cat: WikiCategory) =>
                cat.title.toLowerCase().includes("film") ||
                cat.title.toLowerCase().includes("movie") ||
                cat.title.toLowerCase().includes("cinema")
            ) ||
            page.title.toLowerCase().includes("film") ||
            page.extract?.toLowerCase().includes("film") ||
            page.extract?.toLowerCase().includes("movie") ||
            page.extract?.toLowerCase().includes("directed by") ||
            page.extract?.toLowerCase().includes("starring");

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
              page.varianttitles?.[currentLanguage.id] || page.title,
            extract: page.extract!,
            pageid: page.pageid.toString(),
            thumbnail: page.thumbnail!,
            url: page.canonicalurl!,
            categories: page.categories?.map(cat => cat.title) || [],
          })
        )
        .slice(0, 20);

      // Deduplicate the articles
      const uniqueFilmArticles = deduplicateArticles(filmArticles);

      // Preload images with error handling
      await Promise.allSettled(
        uniqueFilmArticles
          .filter((article) => article.thumbnail)
          .map((article) =>
            preloadImage(article.thumbnail!.source).catch(err => {
              console.warn(`Failed to preload image for ${article.title}:`, err);
            })
          )
      );

      if (forBuffer) {
        setBuffer(prevBuffer => {
          const mergedBuffer = mergeUniqueArticles(prevBuffer, uniqueFilmArticles);
          return deduplicateArticles(mergedBuffer);
        });
      } else {
        setArticles(prev => {
          const mergedArticles = mergeUniqueArticles(prev, uniqueFilmArticles);
          return deduplicateArticles(mergedArticles);
        });
        // Only fetch buffer if we got some articles and we're not already fetching buffer
        if (uniqueFilmArticles.length > 0) {
          setTimeout(() => fetchArticlesRef.current?.(true), 2000);
        }
      }
    } catch (error) {
      console.error("Error in fallback film fetch:", error);
      throw error; // Re-throw to be handled by caller
    }
  };

  const fetchArticles = async (
    forBuffer = false
  ) => {
    if (loading && !forBuffer) return;
    if (!forBuffer) setLoading(true);

    try {
      // First, try the primary method with film years
      const yearPromises = [];
      for (let i = 0; i < 5; i++) {
        const randomYear = getWeightedFilmYear();
        yearPromises.push(fetchFilmsForYear(randomYear));
      }

      const yearResults = await Promise.all(yearPromises);
      const allFilms = yearResults.flat();

      // If we got no films, throw an error to trigger fallback
      if (allFilms.length === 0) {
        throw new Error("No films found in year-based search");
      }

      // Remove duplicates from the films list before proceeding
      const uniqueFilms = Array.from(
        new Map(allFilms.map(film => [film.pageid, film])).values()
      );

      // Randomly select films from all collected unique films
      const shuffled = [...uniqueFilms].sort(() => Math.random() - 0.5);
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

      if (!detailsResponse.ok) {
        throw new Error(`HTTP ${detailsResponse.status}: ${detailsResponse.statusText}`);
      }

      const detailsData: WikiPagesResponse = await detailsResponse.json();

      const newArticles = Object.values(detailsData.query.pages)
        .filter(
          (page: WikiPage) =>
            page.thumbnail &&
            page.thumbnail.source &&
            page.canonicalurl &&
            page.extract &&
            page.extract.length > 100
        )
        .map(
          (page: WikiPage): WikiArticle => ({
            title: page.title,
            displaytitle:
              page.varianttitles?.[currentLanguage.id] || page.title,
            extract: page.extract!,
            pageid: page.pageid.toString(),
            thumbnail: page.thumbnail!,
            url: page.canonicalurl!,
          })
        );

      // Deduplicate the new articles
      const uniqueNewArticles = deduplicateArticles(newArticles);

      // Preload images with better error handling
      await Promise.allSettled(
        uniqueNewArticles
          .filter((article) => article.thumbnail)
          .map((article) =>
            preloadImage(article.thumbnail!.source).catch(err => {
              console.warn(`Failed to preload image for ${article.title}:`, err);
            })
          )
      );

      if (forBuffer) {
        setBuffer(prevBuffer => {
          const mergedBuffer = mergeUniqueArticles(prevBuffer, uniqueNewArticles);
          return deduplicateArticles(mergedBuffer);
        });
      } else {
        setArticles(prev => {
          const mergedArticles = mergeUniqueArticles(prev, uniqueNewArticles);
          return deduplicateArticles(mergedArticles);
        });
        // Only fetch buffer if we got some articles and we're not already fetching buffer
        if (uniqueNewArticles.length > 0) {
          setTimeout(() => fetchArticlesRef.current?.(true), 2000);
        }
      }
    } catch (error) {
      console.error("Primary fetch method failed, trying fallback:", error);
      
      try {
        // Try the fallback method
        await fetchRandomFilmsWithFilter(forBuffer);
      } catch (fallbackError) {
        console.error("Fallback method also failed:", fallbackError);
        // Don't set error state, just let it fail silently for now
      }
    }

    if (!forBuffer) setLoading(false);
  };

  // Update the ref whenever fetchArticles changes
  fetchArticlesRef.current = fetchArticles;

  const getMoreArticles = useCallback(() => {
    if (buffer.length > 0) {
      setArticles(prev => {
        const mergedArticles = mergeUniqueArticles(prev, buffer);
        return deduplicateArticles(mergedArticles);
      });
      setBuffer([]);
      // Fetch new buffer after using current buffer
      setTimeout(() => fetchArticlesRef.current?.(true), 1000);
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