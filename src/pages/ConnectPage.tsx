import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flag, Heart, MessageSquare, Send, ShieldBan, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/translations';
import { apiRequest, queryClient } from '../lib/api';

export function ConnectPage() {
  const { user, databaseConfigured } = useAuth();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'feed' | 'groups'>('feed');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupCategory, setGroupCategory] = useState('Technology');

  const [openCommentsId, setOpenCommentsId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: groups = [] } = useQuery<any[]>({
    queryKey: ['community', 'groups'],
    queryFn: () => apiRequest('/community/groups'),
    enabled: databaseConfigured,
  });

  const { data: posts = [] } = useQuery<any[]>({
    queryKey: ['community', 'posts', 'discussion', selectedGroupId],
    queryFn: () => {
      const qs = new URLSearchParams({ postType: 'discussion' });
      if (selectedGroupId) qs.set('groupId', String(selectedGroupId));
      return apiRequest(`/community/posts?${qs.toString()}`);
    },
    enabled: databaseConfigured,
  });

  const { data: comments = [] } = useQuery<any[]>({
    queryKey: ['community', 'comments', openCommentsId],
    queryFn: () => apiRequest(`/community/posts/${openCommentsId}/comments`),
    enabled: Boolean(openCommentsId),
  });

  const handleCreateDiscussion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    await apiRequest('/community/posts', {
      method: 'POST',
      body: JSON.stringify({
        postType: 'discussion',
        category: 'Community Discussion',
        title: postTitle,
        body: postBody,
        groupId: selectedGroupId,
      }),
    });
    setPostTitle('');
    setPostBody('');
    await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    await apiRequest('/community/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: groupName,
        description: groupDesc,
        category: groupCategory,
        isPrivate: false,
      }),
    });
    setGroupName('');
    setGroupDesc('');
    await queryClient.invalidateQueries({ queryKey: ['community', 'groups'] });
  };

  const handleToggleGroup = async (groupId: number) => {
    if (!user) return;
    await apiRequest(`/community/groups/${groupId}/toggle-join`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['community', 'groups'] });
  };

  const handleFollow = async (targetUserId: number) => {
    if (!user) return;
    const res = await apiRequest<{ following: boolean }>(`/community/users/${targetUserId}/follow`, {
      method: 'POST',
    });
    setFeedback(res.following ? 'Following user.' : 'Unfollowed user.');
  };

  const handleBlock = async (targetUserId: number) => {
    if (!user) return;
    await apiRequest(`/community/users/${targetUserId}/block`, { method: 'POST' });
    setFeedback('User blocked. Their posts and comments are now hidden from your feed.');
    await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
  };

  const handleReport = async (postId: number) => {
    if (!user) return;
    await apiRequest('/community/reports', {
      method: 'POST',
      body: JSON.stringify({ targetType: 'post', targetId: postId, reason: 'other' }),
    });
    setFeedback('Reported to moderators.');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1B3B]">
            {t.connect.title}
          </h1>
          <p className="text-sm text-slate-600 mt-1">{t.connect.subtitle}</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md ${
              activeTab === 'feed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.connect.feedTab}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('groups')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md ${
              activeTab === 'groups' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.connect.groupsTab}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          {feedback}
        </div>
      )}

      {activeTab === 'groups' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {groups.map((g) => (
              <article
                key={g.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-1.5">
                  <div className="text-xs text-slate-500">
                    {g.category} ·{' '}
                    <span className="font-mono-tabular">
                      {g.member_count} {t.connect.members}
                    </span>
                  </div>
                  <h2 className="font-display text-base font-bold text-[#0B1B3B]">{g.name}</h2>
                  <p className="text-sm text-slate-600">{g.description}</p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(g.id);
                      setActiveTab('feed');
                    }}
                    className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Open Discussions
                  </button>
                  {user && (
                    <button
                      type="button"
                      onClick={() => handleToggleGroup(g.id)}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg ${
                        g.is_member
                          ? 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {g.is_member ? t.connect.leaveGroup : t.connect.joinGroup}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>

          <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">
              {t.connect.createGroup}
            </h2>
            {!user ? (
              <p className="text-sm text-slate-600">{t.common.signInRequired}</p>
            ) : (
              <form onSubmit={handleCreateGroup} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="Group name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Category (e.g. Technology, Career)"
                  value={groupCategory}
                  onChange={(e) => setGroupCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <textarea
                  rows={3}
                  required
                  placeholder="What will members discuss?"
                  value={groupDesc}
                  onChange={(e) => setGroupDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-[#0B1B3B] text-white text-sm font-semibold rounded-lg"
                >
                  {t.connect.createGroup}
                </button>
              </form>
            )}
          </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">Start a Discussion</h2>
            {selectedGroupId && (
              <div className="text-xs text-blue-700 flex items-center justify-between">
                <span>Posting in selected group</span>
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(null)}
                  className="underline"
                >
                  All Groups
                </button>
              </div>
            )}
            {!user ? (
              <Link
                to="/auth/login"
                className="inline-block px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg"
              >
                {t.nav.signIn}
              </Link>
            ) : (
              <form onSubmit={handleCreateDiscussion} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="Topic title"
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <textarea
                  rows={4}
                  required
                  placeholder="Ask a question or share advice with the community..."
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                >
                  {t.create.publish}
                </button>
              </form>
            )}
          </section>

          <section className="lg:col-span-8 space-y-4">
            {posts.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                No discussions here yet. Start the first topic!
              </div>
            ) : (
              posts.map((post) => (
                <article key={post.id} className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                        <Link
                          to={`/users/${post.author_username}`}
                          className="font-semibold text-slate-900 hover:text-blue-600"
                        >
                          {post.author_name}
                        </Link>
                        {post.group_name && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{post.group_name}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{new Date(post.created_at).toLocaleDateString()}</span>
                      </div>
                      <h3 className="font-display text-lg font-bold text-[#0B1B3B] mt-1">
                        {post.title}
                      </h3>
                    </div>

                    {user && Number(post.user_id) !== user.id && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleFollow(post.user_id)}
                          title={t.connect.follow}
                          className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-50"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBlock(post.user_id)}
                          title={t.connect.blockUser}
                          className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-50"
                        >
                          <ShieldBan className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReport(post.id)}
                          title={t.common.report}
                          className="p-2 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-slate-50"
                        >
                          <Flag className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {post.body}
                  </p>

                  <div className="flex items-center gap-4 pt-2 border-t border-slate-100 text-xs">
                    <button
                      type="button"
                      disabled={!user}
                      onClick={async () => {
                        await apiRequest(`/community/posts/${post.id}/react`, {
                          method: 'POST',
                          body: JSON.stringify({ reactionType: 'helpful' }),
                        });
                        await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
                      }}
                      className="inline-flex items-center gap-1.5 text-slate-600 hover:text-blue-600 font-medium"
                    >
                      <Heart className="w-4 h-4" />
                      <span className="font-mono-tabular">{post.likes_count}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenCommentsId(openCommentsId === post.id ? null : post.id)
                      }
                      className="inline-flex items-center gap-1.5 text-slate-600 hover:text-[#0B1B3B] font-medium"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span className="font-mono-tabular">
                        {post.comments_count} {t.create.comments}
                      </span>
                    </button>
                  </div>

                  {openCommentsId === post.id && (
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      {comments.map((c) => (
                        <div key={c.id} className="bg-slate-50 rounded-lg p-3 text-sm">
                          <div className="text-xs font-semibold text-slate-900">{c.author_name}</div>
                          <p className="text-slate-700 mt-0.5">{c.body}</p>
                        </div>
                      ))}
                      {user && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!commentText.trim()) return;
                            await apiRequest(`/community/posts/${post.id}/comments`, {
                              method: 'POST',
                              body: JSON.stringify({ body: commentText }),
                            });
                            setCommentText('');
                            await queryClient.invalidateQueries({
                              queryKey: ['community', 'comments', post.id],
                            });
                            await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
                          }}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder={t.create.addComment}
                            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                          <button type="submit" className="p-2 rounded-lg bg-blue-600 text-white">
                            <Send className="w-4 h-4" />
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}
