import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flag, Heart, MessageSquare, Send, Upload, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/translations';
import { ApiError, apiRequest, queryClient } from '../lib/api';
import { PLATFORM_IMAGES } from '../lib/assets';
import { ResilientImage } from '../components/ResilientImage';

const CREATIVE_CATEGORIES = [
  'Technology & Apps',
  'Design & Art',
  'Writing & Stories',
  'Photography',
  'Entrepreneurship',
  'Community Impact',
];

export function CreatePage() {
  const { user, refreshAuth } = useAuth();
  const location = useLocation();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CREATIVE_CATEGORIES[0]);
  const [body, setBody] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openCommentsPostId, setOpenCommentsPostId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [reportTargetId, setReportTargetId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState('spam');
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const { data: posts = [], isLoading } = useQuery<any[]>({
    queryKey: ['community', 'posts', 'create_showcase', categoryFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ postType: 'create_showcase' });
      if (categoryFilter) qs.set('category', categoryFilter);
      return apiRequest(`/community/posts?${qs.toString()}`);
    },
  });

  const { data: comments = [] } = useQuery<any[]>({
    queryKey: ['community', 'comments', openCommentsPostId],
    queryFn: () => apiRequest(`/community/posts/${openCommentsPostId}/comments`),
    enabled: Boolean(openCommentsPostId),
  });

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('postType', 'create_showcase');
      formData.append('category', category);
      formData.append('title', title);
      formData.append('body', body);
      if (imageFile) {
        formData.append('image', imageFile);
      }

      await apiRequest('/community/posts', {
        method: 'POST',
        body: formData,
      });

      setTitle('');
      setBody('');
      setImageFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
      await refreshAuth();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to publish creation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (postId: number) => {
    if (!user) return;
    try {
      await apiRequest(`/community/posts/${postId}/react`, {
        method: 'POST',
        body: JSON.stringify({ reactionType: 'like' }),
      });
      await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
    } catch (err) {
      setReportMessage(err instanceof ApiError ? err.message : 'Unable to update reaction');
    }
  };

  const handleAddComment = async (e: React.FormEvent, postId: number) => {
    e.preventDefault();
    if (!user || !commentText.trim()) return;
    try {
      await apiRequest(`/community/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentText }),
      });
      setCommentText('');
      await queryClient.invalidateQueries({ queryKey: ['community', 'comments', postId] });
      await queryClient.invalidateQueries({ queryKey: ['community', 'posts'] });
    } catch (err) {
      setReportMessage(err instanceof ApiError ? err.message : 'Unable to post comment');
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reportTargetId) return;
    try {
      await apiRequest('/community/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'post',
          targetId: reportTargetId,
          reason: reportReason,
        }),
      });
      setReportTargetId(null);
      setReportMessage('Report submitted for moderator review.');
    } catch (err) {
      setReportMessage(err instanceof ApiError ? err.message : 'Unable to report');
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center space-y-3">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1B3B]">
            {t.create.title}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-xl">{t.create.subtitle}</p>
        </div>
        <div className="lg:col-span-5 min-h-[180px]">
          <ResilientImage
            src={PLATFORM_IMAGES.createStudio}
            alt="Creative studio workspace tools"
            fallbackTitle={t.create.title}
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {reportMessage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          {reportMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Publish Form */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{t.create.newPost}</h2>
          {!user ? (
            <div className="text-sm text-slate-600 space-y-3">
              <p>{t.common.signInRequired}</p>
              <Link
                to="/auth/login"
                state={{ from: location.pathname }}
                className="inline-block px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold"
              >
                {t.nav.signIn}
              </Link>
            </div>
          ) : (
            <form onSubmit={handlePublish} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="create-title" className="block text-xs font-medium text-slate-700 mb-1">
                  {t.create.postTitle}
                </label>
                <input
                  id="create-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="create-cat" className="block text-xs font-medium text-slate-700 mb-1">
                  {t.create.postCategory}
                </label>
                <select
                  id="create-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {CREATIVE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="create-body" className="block text-xs font-medium text-slate-700 mb-1">
                  {t.create.postBody}
                </label>
                <textarea
                  id="create-body"
                  rows={4}
                  required
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="create-image" className="block text-xs font-medium text-slate-700 mb-1">
                  {t.create.attachImage}
                </label>
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-600 cursor-pointer hover:bg-slate-50">
                  <Upload className="w-4 h-4 text-blue-600" aria-hidden="true" />
                  <span className="truncate">{imageFile ? imageFile.name : 'Choose image file...'}</span>
                  <input
                    ref={fileInputRef}
                    id="create-image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                    className="sr-only"
                  />
                </label>
                {imagePreviewUrl && (
                  <div className="mt-2 relative rounded-lg overflow-hidden border border-slate-200 max-h-44">
                    <img src={imagePreviewUrl} alt="Selected upload preview" className="w-full h-40 object-cover" />
                    <button
                      type="button"
                      onClick={() => {
                        setImageFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      aria-label="Remove image"
                      className="absolute top-2 right-2 p-1 rounded-full bg-slate-900/75 text-white hover:bg-slate-900"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold"
              >
                {submitting ? t.common.loading : t.create.publish}
              </button>
            </form>
          )}
        </section>

        {/* Showcase Feed */}
        <section className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setCategoryFilter('')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                categoryFilter === '' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t.common.all}
            </button>
            {CREATIVE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  categoryFilter === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-sm text-slate-500">{t.common.loading}</div>
          ) : posts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              {t.common.noResults}
            </div>
          ) : (
            posts.map((post) => (
              <article
                key={post.id}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                      <Link
                        to={`/users/${post.author_username}`}
                        className="font-semibold text-slate-900 hover:text-blue-600"
                      >
                        {post.author_name}
                      </Link>
                      <span aria-hidden="true">·</span>
                      <span>{post.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    </div>
                    <h3 className="font-display text-lg font-bold text-[#0B1B3B] mt-1">
                      {post.title}
                    </h3>
                  </div>

                  {user && (
                    <button
                      type="button"
                      onClick={() => setReportTargetId(post.id)}
                      aria-label={t.common.report}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-50"
                    >
                      <Flag className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {post.media_url && (
                  <div className="rounded-lg overflow-hidden border border-slate-200 max-h-80">
                    <ResilientImage
                      src={post.media_url}
                      alt={post.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {post.body}
                </p>

                <div className="flex items-center gap-4 pt-2 border-t border-slate-100 text-xs">
                  <button
                    type="button"
                    disabled={!user}
                    onClick={() => handleLike(post.id)}
                    className={`inline-flex items-center gap-1.5 font-medium ${
                      post.user_reaction ? 'text-blue-600' : 'text-slate-600 hover:text-blue-600'
                    }`}
                  >
                    <Heart className="w-4 h-4" aria-hidden="true" />
                    <span className="font-mono-tabular">{post.likes_count}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setOpenCommentsPostId(openCommentsPostId === post.id ? null : post.id)
                    }
                    className="inline-flex items-center gap-1.5 font-medium text-slate-600 hover:text-[#0B1B3B]"
                  >
                    <MessageSquare className="w-4 h-4" aria-hidden="true" />
                    <span className="font-mono-tabular">
                      {post.comments_count} {t.create.comments}
                    </span>
                  </button>
                </div>

                {openCommentsPostId === post.id && (
                  <div className="pt-3 border-t border-slate-100 space-y-3">
                    {comments.map((c) => (
                      <div key={c.id} className="bg-slate-50 rounded-lg p-3 text-sm">
                        <div className="text-xs font-semibold text-slate-900">{c.author_name}</div>
                        <p className="text-slate-700 mt-0.5">{c.body}</p>
                      </div>
                    ))}
                    {user && (
                      <form
                        onSubmit={(e) => handleAddComment(e, post.id)}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder={t.create.addComment}
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                        <button
                          type="submit"
                          aria-label="Send comment"
                          className="p-2 rounded-lg bg-blue-600 text-white"
                        >
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

      {/* Report Modal */}
      {reportTargetId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#0B1B3B]">{t.common.report}</h2>
            <form onSubmit={handleReportSubmit} className="space-y-4">
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="spam">Spam or misleading promotion</option>
                <option value="harassment">Harassment or abusive behavior</option>
                <option value="inappropriate_for_youth">Unsafe for youth (13–17)</option>
                <option value="misinformation">False information</option>
                <option value="other">Other safety concern</option>
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportTargetId(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg"
                >
                  {t.common.submit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
