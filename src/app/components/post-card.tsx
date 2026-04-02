"use client";

import Link from "next/link";
import LikeButton from "./like-button";

type PostCardProps = {
  post: {
    id: string;
    content: string;
    imageUrl?: string | null;
    linkUrl?: string | null;
    createdAt: string;
    author: { id: string; name: string | null; image: string | null };
    group?: { id: string; name: string };
    _count: { replies: number; likes: number };
  };
  showGroup?: boolean;
  currentUserId?: string;
};

export default function PostCard({
  post,
  showGroup = false,
  currentUserId,
}: PostCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start gap-3">
        <Link href={`/profile/${post.author.id}`}>
          {post.author.image ? (
            <img
              src={post.author.image}
              alt={post.author.name || ""}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-sm font-bold text-white">
              {(post.author.name || "?")[0]}
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/profile/${post.author.id}`}
              className="font-medium text-gray-900 hover:underline dark:text-white"
            >
              {post.author.name || "Anonymous"}
            </Link>
            {showGroup && post.group && (
              <>
                <span className="text-gray-400">in</span>
                <Link
                  href={`/groups/${post.group.id}`}
                  className="font-medium text-purple-600 hover:underline dark:text-purple-400"
                >
                  {post.group.name}
                </Link>
              </>
            )}
            <span className="text-gray-400 dark:text-gray-500">
              {new Date(post.createdAt).toLocaleDateString()}
            </span>
          </div>

          <p className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200">
            {post.content}
          </p>

          {post.imageUrl && (
            <img
              src={post.imageUrl}
              alt=""
              className="mt-3 max-h-96 rounded-lg object-cover"
            />
          )}

          {post.linkUrl && (
            <a
              href={post.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-sm text-purple-600 hover:underline dark:text-purple-400"
            >
              {post.linkUrl}
            </a>
          )}

          <div className="mt-3 flex items-center gap-4">
            <LikeButton
              postId={post.id}
              initialCount={post._count.likes}
              loggedIn={!!currentUserId}
            />
            <Link
              href={`/groups/${post.group?.id || "#"}?post=${post.id}`}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400"
            >
              <span>{post._count.replies}</span>
              <span>{post._count.replies === 1 ? "reply" : "replies"}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
