export interface ArticleProps {
    id?: string | number;
    title: string;
    content: string;
    image?: string;
    date?: string;
}

export interface ArticleListProps {
  articles: ArticleProps[];
  onArticleSelect: (article: ArticleProps) => void;
}