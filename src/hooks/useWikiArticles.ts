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

const preloadImage = (src: string): Promise<void> => {
  return new Promise((resolve) => {
    const img = new Image();
    let resolved = false;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        resolve(); // Always resolve, never reject
      }
    };
    
    img.onload = cleanup;
    img.onerror = cleanup; // Don't reject on error, just resolve
    
    // Shorter timeout and always resolve
    setTimeout(cleanup, 2000);
    
    // Set src after setting up handlers
    img.src = src;
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

// Add retry logic for API calls
const fetchWithRetry = async (url: string, retries = 2, delay = 1000): Promise<Response> => {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      
      if (response.status === 429 || response.status >= 500) {
        // Rate limited or server error - retry
        if (i < retries) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
          continue;
        }
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      if (i === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries reached');
};

export function useWikiArticles() {
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [buffer, setBuffer] = useState<WikiArticle[]>([]);
  const { currentLanguage } = useLocalization();
  
  // Cache for film titles to avoid repeated category queries
  const filmCacheRef = useRef<Map<number, WikiCategoryMember[]>>(new Map());
  const lastFetchTimeRef = useRef<number>(0);
  
  // Use ref to store the latest fetchArticles function
  const fetchArticlesRef = useRef<(forBuffer?: boolean) => Promise<void>>(() => Promise.resolve());

  const getWeightedFilmYear = () => {
    const currentYear = new Date().getFullYear();
    const startYear = 1929;
    const random = Math.random();
    return Math.floor(
      currentYear - Math.pow(random, 0.5) * (currentYear - startYear)
    );
  };

  const fetchFilmsForYear = async (year: number): Promise<WikiCategoryMember[]> => {
    // Check cache first
    if (filmCacheRef.current.has(year)) {
      return filmCacheRef.current.get(year)!;
    }

    try {
      const url = currentLanguage.api + new URLSearchParams({
        action: "query",
        format: "json",
        list: "categorymembers",
        cmtitle: `Category:${year} films`,
        cmnamespace: "0",
        cmlimit: "500", // Increased limit to get more films per request
        origin: "*",
      });

      const response = await fetchWithRetry(url);
      const data: WikiCategoryResponse = await response.json();
      const films = data.query?.categorymembers || [];
      
      // Cache the result
      filmCacheRef.current.set(year, films);
      
      return films;
    } catch (error) {
      console.error(`Error fetching films for ${year}:`, error);
      return [];
    }
  };

  // Optimized method: fetch fewer years but get more films from each
  const fetchFilmArticles = async (forBuffer = false) => {
    try {
      // Reduce from 5 years to 2-3 years but get more films per year
      const numYears = 2;
      const yearPromises = [];
      
      for (let i = 0; i < numYears; i++) {
        const randomYear = getWeightedFilmYear();
        yearPromises.push(fetchFilmsForYear(randomYear));
      }

      const yearResults = await Promise.all(yearPromises);
      const allFilms = yearResults.flat();

      if (allFilms.length === 0) {
        throw new Error("No films found in year-based search");
      }

      // Remove duplicates and get more films
      const uniqueFilms = Array.from(
        new Map(allFilms.map(film => [film.pageid, film])).values()
      );

      // Randomly select more films but make fewer API calls
      const shuffled = [...uniqueFilms].sort(() => Math.random() - 0.5);
      const selectedTitles = shuffled
        .slice(0, 30) // Increased from 20 to 30
        .map((film: WikiCategoryMember) => film.title);

      // Split into smaller batches to avoid URL length limits
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < selectedTitles.length; i += batchSize) {
        batches.push(selectedTitles.slice(i, i + batchSize));
      }

      const allNewArticles: WikiArticle[] = [];

      // Process batches sequentially to avoid rate limiting
      for (const batch of batches) {
        try {
          const url = currentLanguage.api + new URLSearchParams({
            action: "query",
            format: "json",
            titles: batch.join("|"),
            prop: "extracts|info|pageimages",
            inprop: "url|varianttitles",
            exintro: "1",
            exlimit: "max",
            exsentences: "3", // Reduced from 5 to 3 for smaller payloads
            explaintext: "1",
            piprop: "thumbnail",
            pithumbsize: "600", // Reduced from 800 to 600
            origin: "*",
            variant: currentLanguage.id,
          });

          const detailsResponse = await fetchWithRetry(url);
          const detailsData: WikiPagesResponse = await detailsResponse.json();

          const batchArticles = Object.values(detailsData.query.pages)
            .filter(
              (page: WikiPage) =>
                page.thumbnail &&
                page.thumbnail.source &&
                page.canonicalurl &&
                page.extract &&
                page.extract.length > 50 // Reduced threshold
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

          allNewArticles.push(...batchArticles);
          
          // Add small delay between batches
          if (batches.indexOf(batch) < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.warn(`Batch failed, continuing with others:`, error);
          continue;
        }
      }

      // Deduplicate the new articles
      const uniqueNewArticles = deduplicateArticles(allNewArticles);

      // Preload only first few images with fire-and-forget approach
      const imagesToPreload = uniqueNewArticles.slice(0, 3);
      
      // Fire and forget - don't wait for image preloading to complete
      imagesToPreload
        .filter((article) => article.thumbnail)
        .forEach((article) => {
          preloadImage(article.thumbnail!.source).catch(() => {
            // Silently ignore preload failures
          });
        });

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
        
        // Only fetch buffer if we got enough articles and enough time has passed
        if (uniqueNewArticles.length > 5) {
          setTimeout(() => fetchArticlesRef.current?.(true), 5000); // Increased delay
        }
      }

      return uniqueNewArticles;
    } catch (error) {
      console.error("Film fetch failed:", error);
      throw error;
    }
  };

  // Simplified fallback method
  const fetchRandomFilmsWithFilter = async (forBuffer = false) => {
    try {
      const url = currentLanguage.api + new URLSearchParams({
        action: "query",
        format: "json",
        generator: "random",
        grnnamespace: "0",
        prop: "extracts|info|pageimages|categories",
        inprop: "url|varianttitles",
        grnlimit: "30", // Reduced from 50
        exintro: "1",
        exlimit: "max",
        exsentences: "3", // Reduced from 5
        explaintext: "1",
        piprop: "thumbnail",
        pithumbsize: "600", // Reduced from 800
        cllimit: "20", // Reduced from 50
        origin: "*",
        variant: currentLanguage.id,
      });

      const response = await fetchWithRetry(url);
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
            page.extract.length > 50 // Reduced threshold
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
        .slice(0, 15); // Reduced from 20

      const uniqueFilmArticles = deduplicateArticles(filmArticles);

      // Fire and forget image preloading
      const imagesToPreload = uniqueFilmArticles.slice(0, 2);
      imagesToPreload
        .filter((article) => article.thumbnail)
        .forEach((article) => {
          preloadImage(article.thumbnail!.source).catch(() => {
            // Silently ignore preload failures
          });
        });

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
        
        if (uniqueFilmArticles.length > 3) {
          setTimeout(() => fetchArticlesRef.current?.(true), 5000);
        }
      }
    } catch (error) {
      console.error("Error in fallback film fetch:", error);
      throw error;
    }
  };

  const fetchArticles = async (forBuffer = false) => {
    // Rate limiting: prevent too frequent calls
    const now = Date.now();
    if (!forBuffer && now - lastFetchTimeRef.current < 2000) {
      console.log("Rate limited: too soon since last fetch");
      return;
    }

    if (loading && !forBuffer) return;
    if (!forBuffer) {
      setLoading(true);
      lastFetchTimeRef.current = now;
    }

    try {
      await fetchFilmArticles(forBuffer);
    } catch (error) {
      console.error("Primary fetch method failed, trying fallback:", error);
      
      try {
        await fetchRandomFilmsWithFilter(forBuffer);
      } catch (fallbackError) {
        console.error("Fallback method also failed:", fallbackError);
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
      setTimeout(() => fetchArticlesRef.current?.(true), 3000); // Increased delay
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