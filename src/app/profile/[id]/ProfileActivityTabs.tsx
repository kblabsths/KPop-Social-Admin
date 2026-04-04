"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface Concert {
  id: string;
  status: string;
  concert: {
    id: string;
    title: string;
    date: string;
    venue: { id: string; name: string; city: string; country: string } | null;
    artists: { id: string; name: string; slug: string; image: string | null }[];
  };
}

interface Artist {
  id: string;
  artist: {
    id: string;
    name: string;
    slug: string;
    image: string | null;
    type: string | null;
    company: string | null;
  };
}

interface Group {
  id: string;
  role: string;
  group: {
    id: string;
    name: string;
    image: string | null;
    isOfficial: boolean;
    artistId: string | null;
  };
  joinedAt: string;
}

interface Post {
  id: string;
  content: string;
  imageUrl: string | null;
  group: { id: string; name: string } | null;
  likeCount: number;
  replyCount: number;
  createdAt: string;
}

interface ActivityData {
  concerts: Concert[];
  artists: Artist[];
  groups: Group[];
  posts: Post[];
  stats: {
    concertCount: number;
    artistFollowCount: number;
    groupCount: number;
    postCount: number;
  };
}

const TABS = ["Concerts", "Artists", "Groups", "Posts"] as const;
type Tab = (typeof TABS)[number];

function StatusBadge({ status }: { status: string }) {
  const label = status === "going" ? "Going" : "Interested";
  const cls =
    status === "going"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ConcertsSection({ concerts }: { concerts: Concert[] }) {
  if (concerts.length === 0) {
    return (
      <p className="py-8 text-center text-gray-400 dark:text-gray-500">
        No upcoming concerts yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {concerts.map(({ id, status, concert }) => (
        <li key={id} className="py-4">
          <Link
            href={`/concerts/${concert.id}`}
            className="group flex items-start justify-between gap-4 hover:opacity-80"
          >
            <div className="flex-1">
              <p className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                {concert.title}
              </p>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {new Date(concert.date).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {concert.venue && (
                  <> &middot; {concert.venue.name}, {concert.venue.city}</>
                )}
              </p>
              {concert.artists.length > 0 && (
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  {concert.artists.map((a) => a.name).join(", ")}
                </p>
              )}
            </div>
            <StatusBadge status={status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ArtistsSection({ artists }: { artists: Artist[] }) {
  if (artists.length === 0) {
    return (
      <p className="py-8 text-center text-gray-400 dark:text-gray-500">
        Not following any artists yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {artists.map(({ id, artist }) => (
        <Link
          key={id}
          href={`/artists/${artist.slug}`}
          className="group flex flex-col items-center gap-2 rounded-xl p-3 transition hover:bg-purple-50 dark:hover:bg-purple-900/20"
        >
          {artist.image ? (
            <Image
              src={artist.image}
              alt={artist.name}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-xl font-bold text-white">
              {artist.name[0]?.toUpperCase()}
            </div>
          )}
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
              {artist.name}
            </p>
            {artist.type && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {artist.type}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

function GroupsSection({ groups }: { groups: Group[] }) {
  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-gray-400 dark:text-gray-500">
        Not a member of any groups yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {groups.map(({ id, group, role }) => (
        <li key={id} className="py-3">
          <Link
            href={`/groups/${group.id}`}
            className="group flex items-center gap-3 hover:opacity-80"
          >
            {group.image ? (
              <Image
                src={group.image}
                alt={group.name}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-300 to-pink-300 text-sm font-bold text-white">
                {group.name[0]?.toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <p className="font-medium text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                {group.name}
              </p>
              {group.isOfficial && (
                <p className="text-xs text-purple-500 dark:text-purple-400">
                  Official
                </p>
              )}
            </div>
            {role === "admin" && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                Admin
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PostsSection({ posts }: { posts: Post[] }) {
  if (posts.length === 0) {
    return (
      <p className="py-8 text-center text-gray-400 dark:text-gray-500">
        No posts yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {posts.map((post) => (
        <li key={post.id} className="py-4">
          <Link
            href={post.group ? `/groups/${post.group.id}` : "#"}
            className="group block hover:opacity-80"
          >
            <p className="line-clamp-3 text-gray-700 group-hover:text-purple-700 dark:text-gray-300 dark:group-hover:text-purple-300">
              {post.content}
            </p>
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
              {post.group && (
                <span className="font-medium text-purple-500 dark:text-purple-400">
                  {post.group.name}
                </span>
              )}
              <span>
                {new Date(post.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span>{post.likeCount} likes</span>
              <span>{post.replyCount} replies</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ProfileActivityTabs({
  activity,
}: {
  activity: ActivityData;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("Concerts");
  const { stats, concerts, artists, groups, posts } = activity;

  const counts: Record<Tab, number> = {
    Concerts: stats.concertCount,
    Artists: stats.artistFollowCount,
    Groups: stats.groupCount,
    Posts: stats.postCount,
  };

  return (
    <div className="mt-8">
      {/* Stats row */}
      <div className="mb-6 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
        <span>
          <strong className="text-gray-900 dark:text-white">{stats.concertCount}</strong>{" "}
          concerts
        </span>
        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
        <span>
          <strong className="text-gray-900 dark:text-white">{stats.artistFollowCount}</strong>{" "}
          artists
        </span>
        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
        <span>
          <strong className="text-gray-900 dark:text-white">{stats.groupCount}</strong>{" "}
          groups
        </span>
        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
        <span>
          <strong className="text-gray-900 dark:text-white">{stats.postCount}</strong>{" "}
          posts
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === tab
                ? "bg-white text-purple-700 shadow-sm dark:bg-gray-700 dark:text-purple-300"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab}
            {counts[tab] > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{counts[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === "Concerts" && <ConcertsSection concerts={concerts} />}
        {activeTab === "Artists" && <ArtistsSection artists={artists} />}
        {activeTab === "Groups" && <GroupsSection groups={groups} />}
        {activeTab === "Posts" && <PostsSection posts={posts} />}
      </div>
    </div>
  );
}
