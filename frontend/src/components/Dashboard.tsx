import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProfiles, type Profile, uploadFile, deleteProfile, retryProcessing } from '../api';
import { Calendar, FileText, Upload, X, Trash2, RefreshCw, AlertCircle, Music2, Mic2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const Dashboard: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      const data = await getProfiles();
      data.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
      setProfiles(data);
    } catch (error) {
      console.error('Failed to fetch profiles', error);
    }
  };

  const totalChunks = useMemo(
    () => profiles.reduce((acc, p) => acc + (p.recordings[0]?.chunks.filter((c) => c.should_process).length || 0), 0),
    [profiles],
  );

  const singingChunks = useMemo(
    () =>
      profiles.reduce(
        (acc, p) =>
          acc + (p.recordings[0]?.chunks.filter((c) => c.content_type === 'singing' && c.should_process).length || 0),
        0,
      ),
    [profiles],
  );

  const handleDeleteProfile = async () => {
    if (!profileToDelete) return;
    try {
      await deleteProfile(profileToDelete.id);
      setProfileToDelete(null);
      fetchProfiles();
    } catch (error) {
      console.error('Failed to delete profile', error);
      alert('Failed to delete profile');
    }
  };

  const handleRetry = async (e: React.MouseEvent, profileId: number) => {
    e.preventDefault();
    e.stopPropagation();

    setRetryingIds((prev) => new Set(prev).add(profileId));
    try {
      await retryProcessing(profileId);
      fetchProfiles();
      alert('Processing restarted. Please wait.');
    } catch (error) {
      console.error('Retry failed', error);
      alert('Retry failed. Check console.');
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(profileId);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-600/30 via-violet-500/20 to-fuchsia-500/20 p-8 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="mb-2 text-sm font-medium text-indigo-200">Audio analysis workspace</p>
              <h1 className="text-4xl font-bold tracking-tight">Smart Voice Splitter</h1>
              <p className="mt-3 text-slate-300">講義音声と唄セクションを自動整理し、復習しやすく表示します。</p>
            </div>
            <div className="flex gap-3">
              <button onClick={fetchProfiles} className="rounded-xl border border-white/15 bg-white/5 p-3 hover:bg-white/10" title="Refresh List">
                <RefreshCw size={20} />
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white hover:bg-indigo-400"
              >
                <Upload size={18} />
                New Upload
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={<FileText size={18} />} label="Profiles" value={profiles.length} />
            <StatCard icon={<Mic2 size={18} />} label="All Chunks" value={totalChunks} />
            <StatCard icon={<Music2 size={18} />} label="Singing Chunks" value={singingChunks} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => {
            const recording = profile.recordings[0];
            const status = recording?.status || 'pending';
            const isProcessing = status === 'processing' || status === 'splitting' || retryingIds.has(profile.id);
            const isAwaitingSelection = status === 'awaiting_selection';
            const showRetry = recording && !isProcessing && (status === 'failed' || (status === 'completed' && recording.chunks.length === 0));
            const songCount = recording?.chunks.filter((c) => c.content_type === 'singing' && c.should_process).length || 0;

            return (
              <Link
                to={`/profiles/${profile.id}`}
                key={profile.id}
                className="group relative rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg transition hover:-translate-y-0.5 hover:border-indigo-300/40 hover:bg-white/10"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setProfileToDelete(profile);
                  }}
                  className="absolute right-4 top-4 rounded-full p-2 text-slate-300 opacity-0 transition hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100"
                  title="Delete Profile"
                >
                  <Trash2 size={18} />
                </button>

                <h2 className="mb-2 pr-8 text-xl font-semibold text-white">{profile.title}</h2>
                <div className="mb-4 flex items-center text-sm text-slate-300">
                  <Calendar size={15} className="mr-2" />
                  {new Date(profile.recorded_at).toLocaleString()}
                </div>

                {profile.summary && <p className="mb-4 line-clamp-3 text-sm text-slate-200/80">{profile.summary}</p>}

                <div className="mb-4 flex items-center gap-2 text-xs text-indigo-100">
                  <span className="rounded-full bg-indigo-500/30 px-2 py-1">Chunk: {recording?.chunks.filter((c) => c.should_process).length || 0}</span>
                  <span className="rounded-full bg-fuchsia-500/30 px-2 py-1">🎵 {songCount}</span>
                </div>

                {isProcessing ? (
                  <div className="mt-4 flex items-center text-sm font-medium text-amber-300">
                    <RefreshCw size={16} className="mr-1 animate-spin" />
                    {status === 'splitting' ? 'Splitting chunks...' : 'Processing...'}
                  </div>
                ) : isAwaitingSelection ? (
                  <div className="mt-4 flex items-center text-sm font-medium text-sky-300">
                    <AlertCircle size={16} className="mr-1" />
                    Select target chunks
                  </div>
                ) : showRetry ? (
                  <div className="mt-4 flex items-center gap-4">
                    <div className="flex items-center text-sm font-medium text-rose-300">
                      <AlertCircle size={16} className="mr-1" />
                      Processing Failed
                    </div>
                    <button onClick={(e) => handleRetry(e, profile.id)} className="text-sm font-medium text-indigo-300 hover:underline">
                      Resume
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center text-sm font-semibold text-indigo-200">
                    <FileText size={16} className="mr-1" />
                    View Details
                  </div>
                )}
              </Link>
            );
          })}
        </div>

        {profiles.length === 0 && <div className="py-12 text-center text-slate-300">No recordings found. Start by uploading a new file.</div>}
      </div>

      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            setShowUploadModal(false);
            fetchProfiles();
          }}
        />
      )}

      {profileToDelete && <DeleteModal profile={profileToDelete} onClose={() => setProfileToDelete(null)} onConfirm={handleDeleteProfile} />}
    </div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({ icon, label, value }) => (
  <div className="rounded-xl border border-white/15 bg-white/5 p-4">
    <div className="mb-2 flex items-center gap-2 text-indigo-200">{icon}<span className="text-sm">{label}</span></div>
    <p className="text-2xl font-bold text-white">{value}</p>
  </div>
);

interface UploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ onClose, onSuccess }) => {
  const [title, setTitle] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [summary, setSummary] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !recordedAt) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('title', title);
    formData.append('recorded_at', recordedAt);
    formData.append('summary', summary);
    formData.append('file', file);

    try {
      await uploadFile(formData);
      onSuccess();
    } catch (err) {
      console.error('Upload failed', err);
      setError('Upload failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl border border-white/20 bg-slate-900 p-8 text-slate-100 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-300 hover:text-white"><X size={24} /></button>
        <h2 className="mb-6 text-2xl font-bold">Upload New Recording</h2>
        {error && <div className="mb-4 rounded-lg bg-red-500/20 p-3 text-red-100">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Title *"><input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-white/15 bg-slate-800 p-2" /></Field>
          <Field label="Recorded At *"><input type="datetime-local" required value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} className="w-full rounded-lg border border-white/15 bg-slate-800 p-2" /></Field>
          <Field label="Summary"><textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full rounded-lg border border-white/15 bg-slate-800 p-2" rows={3} /></Field>
          <Field label="Audio File *"><input type="file" required accept="audio/*" onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} className="w-full rounded-lg border border-white/15 bg-slate-800 p-2" /></Field>
          <button type="submit" disabled={loading} className={cn('w-full rounded-lg py-2 font-semibold text-white', loading ? 'bg-slate-500' : 'bg-indigo-500 hover:bg-indigo-400')}>
            {loading ? 'AI is processing audio...' : 'Upload & Process'}
          </button>
        </form>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="mb-1 block text-sm text-slate-200">{label}</label>
    {children}
  </div>
);

interface DeleteModalProps {
  profile: Profile;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const DeleteModal: React.FC<DeleteModalProps> = ({ profile, onClose, onConfirm }) => {
  const [titleConfirm, setTitleConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const isMatch = titleConfirm === profile.title;

  const handleConfirm = async () => {
    if (!isMatch) return;
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-white/20 bg-slate-900 p-8 text-slate-100 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-300 hover:text-white"><X size={24} /></button>
        <h2 className="mb-4 text-xl font-bold text-red-300">Delete Profile</h2>
        <p className="mb-4 text-slate-200">Are you sure you want to delete <strong>{profile.title}</strong>? This action cannot be undone.</p>
        <p className="mb-2 text-sm text-slate-300">Please type <strong>{profile.title}</strong> to confirm.</p>
        <input type="text" value={titleConfirm} onChange={(e) => setTitleConfirm(e.target.value)} className="mb-6 w-full rounded-lg border border-white/15 bg-slate-800 p-2" />
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-slate-200 hover:bg-white/10" disabled={loading}>Cancel</button>
          <button onClick={handleConfirm} disabled={!isMatch || loading} className={cn('rounded-lg px-4 py-2 font-medium text-white', !isMatch || loading ? 'bg-slate-600' : 'bg-red-600 hover:bg-red-500')}>
            {loading ? 'Deleting...' : 'Delete Profile'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
