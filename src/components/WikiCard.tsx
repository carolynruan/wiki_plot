import { Share2 } from "lucide-react";
import { useState } from "react";

export interface WikiArticle {
  title: string;
  displaytitle: string;
  extract: string;
  pageid: string;
  url: string;
  thumbnail: { source: string; width: number; height: number };
  categories?: string[];
}

interface WikiCardProps { article: WikiArticle }

export function WikiCard({ article }: WikiCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.displaytitle,
          text: article.extract || "",
          url: article.url,
        });
      } catch {}
    } else {
      await navigator.clipboard.writeText(article.url);
      alert("Link copied to clipboard!");
    }
  };

  return (
    <section className="h-screen snap-start">
      <div className="article-container">
        <img
          loading="lazy"
          src={article.thumbnail?.source}
          alt={article.displaytitle}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          className={`article-image transition-opacity duration-300 ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
        {!imageLoaded && (
          <div className="article-image bg-gray-900 animate-pulse" />
        )}
        
        <div className="absolute inset-0 z-[1] bg-gradient-to-b from-black/50 via-black/30 to-black/60" />

        <div className="absolute inset-0 z-[1] pointer-events-auto bg-gradient-to-b from-black/10 via-black/20 to-black/40" />

        <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="article-content max-w-[90%] md:max-w-[75%]">
            <div className="flex items-start justify-between gap-3 mb-2">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-200"
              >
                <h2 className="text-2xl font-bold drop-shadow">
                  {article.displaytitle}
                </h2>
              </a>
              <button
                onClick={handleShare}
                className="shrink-0 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Share article"
              >
                <Share2 className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-100/95 drop-shadow mb-3 line-clamp-6">
              {article.extract}
            </p>

            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block hover:text-gray-200"
            >
              Read more →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
