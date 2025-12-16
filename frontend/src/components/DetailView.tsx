import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getProfile, updateChunk, type Profile, type Chunk } from '../api';
import { ArrowLeft, Clock, Play, Pause, Bookmark, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const DetailView: React.FC = () => {
    const { profileId } = useParams<{ profileId: string }>();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    // currentChunkId tracks which chunk corresponds to current playback time
    const [currentPlayingChunkId, setCurrentPlayingChunkId] = useState<number | null>(null);
    // expandedChunkId tracks which accordion item is open
    const [expandedChunkId, setExpandedChunkId] = useState<number | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    // Map of chunkId -> note draft
    const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
    const [savingStatus, setSavingStatus] = useState<Record<number, 'saving' | 'saved' | null>>({});

    const audioRef = useRef<HTMLAudioElement>(null);
    const notesDebounceRefs = useRef<Record<number, NodeJS.Timeout>>({});
    const chunkRefs = useRef<Record<number, HTMLDivElement | null>>({});

    // Assuming first recording for now
    const recording = profile?.recordings[0];
    const chunks = recording?.chunks || [];

    useEffect(() => {
        if (profileId) {
            fetchProfile(Number(profileId));
        }
    }, [profileId]);

    // Cleanup debounces on unmount
    useEffect(() => {
        return () => {
            Object.values(notesDebounceRefs.current).forEach(timeout => clearTimeout(timeout));
        };
    }, []);

    // Sync current time with active chunk and scroll
    useEffect(() => {
        if (!recording) return;

        const playingChunk = chunks.find(
            c => currentTime >= c.start_time && currentTime < c.end_time
        );

        if (playingChunk && playingChunk.id !== currentPlayingChunkId) {
            setCurrentPlayingChunkId(playingChunk.id);
            // Auto-expand the playing chunk if it's strictly following the previous one? 
            // The requirement says "auto-scroll... and highlight".
            // It doesn't explicitly say "auto-expand", but it implies visibility.
            // Let's expand it so user sees the text they are hearing.
            setExpandedChunkId(playingChunk.id);

            // Auto-scroll
            if (chunkRefs.current[playingChunk.id]) {
                chunkRefs.current[playingChunk.id]?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        }
    }, [currentTime, recording, chunks, currentPlayingChunkId]);

    const fetchProfile = async (id: number) => {
        try {
            const data = await getProfile(id);
            setProfile(data);

            // Initialize note drafts
            const drafts: Record<number, string> = {};
            data.recordings.forEach(r => {
                r.chunks.forEach(c => {
                    drafts[c.id] = c.user_note || '';
                });
            });
            setNoteDrafts(drafts);

            if (data.recordings.length > 0 && data.recordings[0].chunks.length > 0) {
                // Optionally start with first one open?
                setExpandedChunkId(data.recordings[0].chunks[0].id);
            }
        } catch (error) {
            console.error('Failed to fetch profile', error);
        } finally {
            setLoading(false);
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const togglePlayback = (e: React.MouseEvent, chunk: Chunk) => {
        e.stopPropagation();
        if (!audioRef.current) return;

        // If this chunk is currently playing (in its time range) AND audio is playing, pause.
        // If not, seek and play.

        // Simpler logic: Is the audio currently playing and are we within this chunk's time?
        const isPlayingThisChunk = !audioRef.current.paused &&
            currentTime >= chunk.start_time &&
            currentTime < chunk.end_time;

        if (isPlayingThisChunk) {
            audioRef.current.pause();
        } else {
            audioRef.current.currentTime = chunk.start_time;
            audioRef.current.play();
            setExpandedChunkId(chunk.id); // Also expand when playing manually
        }
    };

    // Check if audio is actually playing (for UI state)
    // We need a state for "global playing" to toggle icons correctly
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);

    const onPlay = () => setIsAudioPlaying(true);
    const onPause = () => setIsAudioPlaying(false);

    const toggleAccordion = (chunkId: number) => {
        setExpandedChunkId(prev => (prev === chunkId ? null : chunkId));
    };

    const toggleBookmark = async (e: React.MouseEvent, chunkId: number) => {
        e.stopPropagation();
        if (!profile) return;

        // Optimistic update
        const updatedRecordings = profile.recordings.map(r => ({
            ...r,
            chunks: r.chunks.map(c =>
                c.id === chunkId ? { ...c, is_bookmarked: !c.is_bookmarked } : c
            )
        }));

        const wasBookmarked = updatedRecordings[0].chunks.find(c => c.id === chunkId)?.is_bookmarked;
        setProfile({ ...profile, recordings: updatedRecordings });

        try {
            await updateChunk(chunkId, { is_bookmarked: wasBookmarked });
        } catch (err) {
            console.error("Failed to toggle bookmark", err);
            // Revert on error would be ideal here
        }
    };

    const handleNoteChange = (chunkId: number, newNote: string) => {
        setNoteDrafts(prev => ({ ...prev, [chunkId]: newNote }));
        setSavingStatus(prev => ({ ...prev, [chunkId]: 'saving' }));

        // Clear existing debounce for this chunk
        if (notesDebounceRefs.current[chunkId]) {
            clearTimeout(notesDebounceRefs.current[chunkId]);
        }

        // Set new debounce
        notesDebounceRefs.current[chunkId] = setTimeout(async () => {
            try {
                await updateChunk(chunkId, { user_note: newNote });
                setSavingStatus(prev => ({ ...prev, [chunkId]: 'saved' }));
                // Clear 'saved' message after 2 seconds
                setTimeout(() => {
                    setSavingStatus(prev => ({ ...prev, [chunkId]: null }));
                }, 2000);
            } catch (err) {
                console.error("Failed to save note", err);
                // Ideally show error state
            }
        }, 1000); // 1 second debounce
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
    }

    if (loading) return <div className="p-8 text-center">Loading...</div>;
    if (!profile) return <div className="p-8 text-center text-red-500">Profile not found</div>;

    const audioFilename = recording?.file_path.split('/').pop();
    const audioUrl = `http://localhost:8000/static/${audioFilename}`;

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center shadow-sm z-20 sticky top-0">
                <Link to="/" className="text-gray-500 hover:text-gray-800 mr-4">
                    <ArrowLeft size={24} />
                </Link>
                <div>
                    <h1 className="text-xl font-bold text-gray-900">{profile.title}</h1>
                    <div className="text-sm text-gray-500 flex items-center">
                        <Clock size={14} className="mr-1" />
                        {new Date(profile.recorded_at).toLocaleString()}
                    </div>
                </div>
            </header>

            {/* Sticky Player */}
            <div className="bg-white border-b border-gray-200 p-4 sticky top-[73px] z-10 shadow-sm">
                <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    className="w-full"
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={onPlay}
                    onPause={onPause}
                />
            </div>

            {/* Content List */}
            <main className="flex-1 overflow-y-auto p-4 max-w-3xl mx-auto w-full">
                <div className="space-y-4">
                    {chunks.map((chunk) => {
                        const isExpanded = expandedChunkId === chunk.id;
                        const isPlaying = isAudioPlaying &&
                            currentTime >= chunk.start_time &&
                            currentTime < chunk.end_time;
                        const isBookmarked = chunk.is_bookmarked;

                        return (
                            <div
                                key={chunk.id}
                                ref={el => chunkRefs.current[chunk.id] = el}
                                className={cn(
                                    "bg-white rounded-lg border transition-all duration-300 overflow-hidden",
                                    isExpanded || isPlaying
                                        ? "border-blue-300 shadow-md ring-1 ring-blue-100"
                                        : "border-gray-200 hover:border-gray-300"
                                )}
                            >
                                {/* Header / Summary Card */}
                                <div
                                    className="p-4 flex items-center cursor-pointer hover:bg-gray-50 transition-colors"
                                    onClick={() => toggleAccordion(chunk.id)}
                                >
                                    {/* Play Button */}
                                    <button
                                        onClick={(e) => togglePlayback(e, chunk)}
                                        className={cn(
                                            "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center mr-4 transition-colors",
                                            isPlaying
                                                ? "bg-blue-600 text-white"
                                                : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                                        )}
                                    >
                                        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                                    </button>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0 mr-4">
                                        <div className="flex items-center justify-between mb-1">
                                            <h3 className="text-base font-semibold text-gray-900 truncate">
                                                {chunk.title}
                                            </h3>
                                            <span className="text-xs font-mono text-gray-400">
                                                {formatDuration(chunk.start_time, chunk.end_time)}
                                            </span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-500">
                                            <span className="font-mono text-xs bg-gray-100 px-1.5 rounded mr-2">
                                                {formatTimestamp(chunk.start_time)}
                                            </span>
                                            <span className="truncate">
                                                {chunk.transcript.slice(0, 50)}{chunk.transcript.length > 50 ? '...' : ''}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center space-x-2">
                                        <button
                                            onClick={(e) => toggleBookmark(e, chunk.id)}
                                            className={cn(
                                                "p-2 rounded-full transition-colors focus:outline-none",
                                                isBookmarked
                                                    ? "text-yellow-500 hover:bg-yellow-50"
                                                    : "text-gray-300 hover:text-gray-400 hover:bg-gray-100"
                                            )}
                                        >
                                            <Bookmark size={20} fill={isBookmarked ? "currentColor" : "none"} />
                                        </button>
                                        <div className="text-gray-400">
                                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                        </div>
                                    </div>
                                </div>

                                {/* Body / Detailed View */}
                                {isExpanded && (
                                    <div className="border-t border-gray-100 bg-gray-50/50">
                                        <div className="p-6 grid gap-6 md:grid-cols-2">
                                            {/* Full Transcript */}
                                            <div>
                                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                                                    Transcript
                                                </h4>
                                                <p className="text-gray-700 leading-relaxed text-sm whitespace-pre-wrap">
                                                    {chunk.transcript}
                                                </p>
                                            </div>

                                            {/* Notes */}
                                            <div className="flex flex-col h-full">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                                        Notes
                                                    </h4>
                                                    <span className="text-xs text-blue-600 h-4">
                                                        {savingStatus[chunk.id] === 'saving' && 'Saving...'}
                                                        {savingStatus[chunk.id] === 'saved' && 'Saved'}
                                                    </span>
                                                </div>
                                                <textarea
                                                    className="flex-1 w-full p-3 border border-gray-200 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none min-h-[150px]"
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
                </div>
            </main>
        </div>
    );
};

export default DetailView;
