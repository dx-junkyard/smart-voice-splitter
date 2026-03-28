import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getProfile, processSelectedChunks, updateChunk, type Profile, type Chunk } from '../api';
import { ArrowLeft, Clock, Play, Pause, Bookmark, ChevronDown, ChevronUp, Search, Music2, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const DetailView: React.FC = () => {
  const { profileId } = useParams<{ profileId: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPlayingChunkId, setCurrentPlayingChunkId] = useState<number | null>(null);
  const [expandedChunkId, setExpandedChunkId] = useState<number | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [savingStatus, setSavingStatus] = useState<Record<number, 'saving' | 'saved' | null>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'singing' | 'speech'>('all');
  const [showOnlyProcessingTarget, setShowOnlyProcessingTarget] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isStartingProcessing, setIsStartingProcessing] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const notesDebounceRefs = useRef<Record<number, NodeJS.Timeout>>({});

  const recording = profile?.recordings[0];
  const chunks = recording?.chunks || [];

  useEffect(() => {
    if (profileId) fetchProfile(Number(profileId));
  }, [profileId]);

  useEffect(() => {
    return () => {
      Object.values(notesDebounceRefs.current).forEach((timeout) => clearTimeout(timeout));
    };
  }, []);

  const fetchProfile = async (id: number) => {
    try {
      const data = await getProfile(id);
      setProfile(data);
      const drafts: Record<number, string> = {};
      data.recordings.forEach((r) => r.chunks.forEach((c) => (drafts[c.id] = c.user_note || '')));
      setNoteDrafts(drafts);
    } catch (error) {
      console.error('Failed to fetch profile', error);
    } finally {
      setLoading(false);
    }
  };

  const getAudioUrl = (filePath: string | null) => {
    if (!filePath) return '';
    const relativePath = filePath.replace(/^uploads\//, '');
    return `http://localhost:8000/static/${relativePath}`;
  };

  const [currentAudioSrc, setCurrentAudioSrc] = useState<string>('');
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  useEffect(() => {
    if (recording?.file_path && !currentAudioSrc) setCurrentAudioSrc(getAudioUrl(recording.file_path));
  }, [recording]);

  useEffect(() => {
    if (shouldAutoPlay && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch((e) => console.error('Auto-play failed', e));
      setShouldAutoPlay(false);
    }
  }, [currentAudioSrc, shouldAutoPlay]);

  const filteredChunks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return chunks.filter((chunk) => {
      const matchesType = filterMode === 'all' ? true : chunk.content_type === filterMode;
      const matchesProcessTarget = showOnlyProcessingTarget ? chunk.should_process : true;
      const matchesText =
        q.length === 0 ||
        chunk.title.toLowerCase().includes(q) ||
        chunk.transcript.toLowerCase().includes(q) ||
        (chunk.content_type === 'singing' && ['song', 'sing', '唄', '歌', '練習', 'お手本'].some((k) => q.includes(k)));
      return matchesType && matchesText && matchesProcessTarget;
    });
  }, [chunks, filterMode, searchQuery, showOnlyProcessingTarget]);

  const togglePlayback = (e: React.MouseEvent, chunk: Chunk) => {
    e.stopPropagation();
    if (!chunk.file_path) return;
    const chunkUrl = getAudioUrl(chunk.file_path);

    if (expandedChunkId === chunk.id && audioRef.current) {
      if (audioRef.current.paused) audioRef.current.play();
      else audioRef.current.pause();
      setCurrentPlayingChunkId(chunk.id);
      return;
    }

    if (currentAudioSrc !== chunkUrl) {
      setCurrentAudioSrc(chunkUrl);
      setShouldAutoPlay(true);
    }
    setExpandedChunkId(chunk.id);
    setCurrentPlayingChunkId(chunk.id);
  };

  const toggleAccordion = (chunkId: number) => setExpandedChunkId((prev) => (prev === chunkId ? null : chunkId));

  const toggleBookmark = async (e: React.MouseEvent, chunkId: number) => {
    e.stopPropagation();
    if (!profile) return;

    const updatedRecordings = profile.recordings.map((r) => ({
      ...r,
      chunks: r.chunks.map((c) => (c.id === chunkId ? { ...c, is_bookmarked: !c.is_bookmarked } : c)),
    }));

    const wasBookmarked = updatedRecordings[0].chunks.find((c) => c.id === chunkId)?.is_bookmarked;
    setProfile({ ...profile, recordings: updatedRecordings });
    try {
      await updateChunk(chunkId, { is_bookmarked: wasBookmarked });
    } catch (err) {
      console.error('Failed to toggle bookmark', err);
    }
  };

  const toggleShouldProcess = async (e: React.SyntheticEvent, chunkId: number) => {
    e.stopPropagation();
    if (!profile) return;

    const updatedRecordings = profile.recordings.map((r) => ({
      ...r,
      chunks: r.chunks.map((c) => (c.id === chunkId ? { ...c, should_process: !c.should_process } : c)),
    }));
    const nextValue = updatedRecordings[0].chunks.find((c) => c.id === chunkId)?.should_process ?? true;
    setProfile({ ...profile, recordings: updatedRecordings });

    try {
      await updateChunk(chunkId, { should_process: nextValue });
    } catch (err) {
      console.error('Failed to update processing target flag', err);
    }
  };

  const handleStartSelectedChunkProcessing = async () => {
    if (!recording) return;
    setIsStartingProcessing(true);
    try {
      await processSelectedChunks(recording.id);
      await fetchProfile(profile.id);
      alert('選択したチャンクの処理を開始しました。完了まで少しお待ちください。');
    } catch (err) {
      console.error('Failed to start selected chunk processing', err);
      alert('処理開始に失敗しました。');
    } finally {
      setIsStartingProcessing(false);
    }
  };

  const handleNoteChange = (chunkId: number, newNote: string) => {
    setNoteDrafts((prev) => ({ ...prev, [chunkId]: newNote }));
    setSavingStatus((prev) => ({ ...prev, [chunkId]: 'saving' }));
    if (notesDebounceRefs.current[chunkId]) clearTimeout(notesDebounceRefs.current[chunkId]);

    notesDebounceRefs.current[chunkId] = setTimeout(async () => {
      try {
        await updateChunk(chunkId, { user_note: newNote });
        setSavingStatus((prev) => ({ ...prev, [chunkId]: 'saved' }));
        setTimeout(() => setSavingStatus((prev) => ({ ...prev, [chunkId]: null })), 2000);
      } catch (err) {
        console.error('Failed to save note', err);
      }
    }, 1000);
  };

  const formatDuration = (start: number, end: number) => {
    const duration = end - start;
    const m = Math.floor(duration / 60);
    const s = Math.floor(duration % 60);
    return `${m}m ${s}s`;
  };

  const formatTimestamp = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!profile) return <div className="p-8 text-center text-red-500">Profile not found</div>;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-900/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <Link to="/" className="text-slate-300 hover:text-white"><ArrowLeft size={24} /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">{profile.title}</h1>
            <div className="mt-1 flex items-center text-sm text-slate-300"><Clock size={14} className="mr-1" />{new Date(profile.recorded_at).toLocaleString()}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <section className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex flex-wrap gap-3">
            <div className="relative min-w-[250px] flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="チャンク検索（講義/唄/練習ワード）"
                className="w-full rounded-xl border border-white/15 bg-slate-900 py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <div className="flex rounded-xl border border-white/15 bg-slate-900 p-1 text-sm">
              {[
                { key: 'all', label: 'すべて' },
                { key: 'singing', label: '🎵 唄のみ' },
                { key: 'speech', label: '🗣 話のみ' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterMode(f.key as 'all' | 'singing' | 'speech')}
                  className={cn('rounded-lg px-3 py-1.5', filterMode === f.key ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/10')}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={showOnlyProcessingTarget}
                onChange={(e) => setShowOnlyProcessingTarget(e.target.checked)}
              />
              処理対象のみ表示
            </label>
          </div>
          <p className="text-xs text-slate-300">各チャンクの「処理対象」チェックをON/OFFして、後続の処理対象を選べます。強い音量と伸びのある発声を優先して唄区間を自動タグ付け（🎵）しています。</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs text-indigo-100">
              Status: {recording?.status ?? 'unknown'}
            </span>
            <button
              onClick={handleStartSelectedChunkProcessing}
              disabled={!recording || recording.status === 'splitting' || recording.status === 'processing' || isStartingProcessing}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-semibold text-white',
                !recording || recording.status === 'splitting' || recording.status === 'processing' || isStartingProcessing
                  ? 'cursor-not-allowed bg-slate-600'
                  : 'bg-indigo-500 hover:bg-indigo-400',
              )}
            >
              {isStartingProcessing || recording?.status === 'processing' ? '処理中...' : '選択したチャンクを処理'}
            </button>
            {recording?.status === 'awaiting_selection' && (
              <span className="text-xs text-amber-200">チャンク分割が完了しました。処理対象を選んで処理を開始してください。</span>
            )}
          </div>
        </section>

        <div className="space-y-4">
          {filteredChunks.map((chunk) => {
            const isExpanded = expandedChunkId === chunk.id;
            const isPlaying = isAudioPlaying && currentPlayingChunkId === chunk.id;
            const singing = chunk.content_type === 'singing';

            return (
              <div key={chunk.id} className={cn('overflow-hidden rounded-2xl border transition', isExpanded || isPlaying ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-white/10 bg-white/5')}>
                <div className="flex cursor-pointer items-center p-4" onClick={() => toggleAccordion(chunk.id)}>
                  <button onClick={(e) => togglePlayback(e, chunk)} className={cn('mr-4 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full', isPlaying ? 'bg-indigo-500 text-white' : 'bg-indigo-400/20 text-indigo-200')}>
                    {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                  </button>

                  <div className="min-w-0 flex-1 pr-3">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <h3 className="truncate text-base font-semibold text-white">{chunk.title}</h3>
                      <span className="text-xs font-mono text-slate-300">{formatDuration(chunk.start_time, chunk.end_time)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">{formatTimestamp(chunk.start_time)}</span>
                      {singing ? <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-xs text-fuchsia-200"><Music2 size={12} /> Singing</span> : <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-200"><MessageSquare size={12} /> Speech</span>}
                      <span className="truncate">{chunk.transcript.slice(0, 48)}{chunk.transcript.length > 48 ? '…' : ''}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs',
                        chunk.should_process
                          ? 'border-emerald-300/50 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-400/30 bg-slate-700/40 text-slate-300',
                      )}
                    >
                      <input type="checkbox" checked={chunk.should_process} onChange={(e) => toggleShouldProcess(e, chunk.id)} />
                      処理対象
                    </label>
                    <button
                      onClick={(e) => toggleBookmark(e, chunk.id)}
                      className={cn('rounded-full p-2', chunk.is_bookmarked ? 'text-yellow-400 hover:bg-yellow-400/10' : 'text-slate-400 hover:bg-white/10')}
                    >
                      <Bookmark size={20} fill={chunk.is_bookmarked ? 'currentColor' : 'none'} />
                    </button>
                    <div className="text-slate-400">{isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-white/10 bg-slate-900/40 p-5">
                    <audio
                      ref={isExpanded ? audioRef : null}
                      controls
                      className="mb-4 w-full"
                      src={getAudioUrl(chunk.file_path)}
                      preload="metadata"
                      onPlay={() => setIsAudioPlaying(true)}
                      onPause={() => setIsAudioPlaying(false)}
                    />
                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Transcript</h4>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{chunk.transcript}</p>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Notes</h4>
                          <span className="text-xs text-indigo-300">{savingStatus[chunk.id] === 'saving' && 'Saving...'}{savingStatus[chunk.id] === 'saved' && 'Saved'}</span>
                        </div>
                        <textarea
                          className="min-h-[150px] w-full resize-none rounded-md border border-white/15 bg-slate-900 p-3 text-sm"
                          placeholder="Add your notes here..."
                          value={noteDrafts[chunk.id] || ''}
                          onChange={(e) => handleNoteChange(chunk.id, e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredChunks.length === 0 && <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-slate-300">条件に一致するチャンクがありません。</div>}
        </div>
      </main>
    </div>
  );
};

export default DetailView;
