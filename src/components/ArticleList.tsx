import React from 'react';
import { ArticleProps, ArticleListProps } from '../types/ArticleProps';

const ArticleList: React.FC<ArticleListProps> = ({ articles, onArticleSelect }) => {
  return (
    <div className="space-y-4">
      {articles.map((article: ArticleProps) => (
        <div
          key={article.id}
          className="p-4 border rounded cursor-pointer hover:bg-gray-50"
          onClick={() => onArticleSelect(article)}
        >
          <h3 className="font-semibold">{article.title}</h3>
          <p className="text-gray-600">{article.date}</p>
        </div>
      ))}
    </div>
  );
};

export default ArticleList;