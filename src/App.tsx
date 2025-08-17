import { useEffect, useRef, useCallback, useState } from "react";
import { WikiCard } from "./components/WikiCard";
import { Loader2, X } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";
import { LanguageSelector } from "./components/LanguageSelector";
import { useWikiArticles } from "./hooks/useWikiArticles";

function App() {
  const [showAbout, setShowAbout] = useState(false);
  const { articles, loading, fetchArticles } = useWikiArticles();
  const observerTarget = useRef(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && !loading) {
        fetchArticles();
      }
    },
    [loading, fetchArticles]
  );

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, {
      threshold: 0.1,
      rootMargin: "100px",
    });
    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }
    return () => observer.disconnect();
  }, [handleObserver]);

  useEffect(() => {
    fetchArticles();
  }, []);

  return (
    <div className="h-screen w-full bg-black text-white overflow-y-scroll snap-y snap-mandatory hide-scroll">
      <div className="fixed top-0 left-0 right-0 z-50 p-4">
        <div className="max-w-screen-xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 backdrop-blur-md rounded-xl 
                        text-xl font-bold text-white transition-all duration-200 
                        border border-white/10 hover:border-white/20 shadow-lg 
                        flex items-center gap-2"
            >
              WikiPlots
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAbout(!showAbout)}
                className="px-3 py-2 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-xl
                          text-sm font-medium text-white/90 hover:text-white transition-all duration-200
                          border border-white/5 hover:border-white/15"
              >
                About
              </button>
              
              <div className="px-2 py-1 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-xl
                            border border-white/5 hover:border-white/15 transition-all duration-200">
                <LanguageSelector />
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAbout && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-gray-900/95 backdrop-blur-sm border border-gray-700/50 p-8 rounded-xl max-w-md w-full relative shadow-2xl">
            <button
              onClick={() => setShowAbout(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors hover:bg-white/10 rounded-full p-2"
              aria-label="Close about dialog"
            >
              <X className="w-4 h-4" />
            </button>
            
            <h2 className="text-2xl font-bold mb-6 text-white">About WikiPlots</h2>
            
            <div className="space-y-4 text-gray-200">
              <p className="leading-relaxed">
                A TikTok-style interface for exploring random Wikipedia articles of movies. 
                Scroll through and discover fascinating film plots from around the world.
              </p>
              
              <div className="pt-4 border-t border-gray-700/50 space-y-2">
                <p className="text-sm text-gray-300">
                  Made by{" "}
                  <a
                    href="https://carolynruan.github.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors underline"
                  >
                    Carolyn Ruan
                  </a>
                </p>
                
                <p className="text-sm text-gray-300">
                  Forked from WikiTok on{" "}
                  <a
                    href="https://github.com/IsaacGemal/wikitok"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors underline"
                  >
                    GitHub
                  </a>
                </p>
              </div>
            </div>
          </div>
          
          <div 
            className="absolute inset-0 -z-10" 
            onClick={() => setShowAbout(false)}
          />
        </div>
      )}

      {articles.map((article) => (
        <WikiCard key={article.pageid} article={article} />
      ))}

      {/* Intersection Observer Target */}
      <div ref={observerTarget} className="h-10 -mt-1" />

      {/* Loading Indicator */}
      {loading && (
        <div className="h-screen w-full flex items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <span className="text-lg">Loading more articles...</span>
        </div>
      )}

      <Analytics />
    </div>
  );
}

export default App;