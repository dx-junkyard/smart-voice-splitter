import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getProfile, updateChunkNote, type Profile, type Chunk } from '../api';
import { ArrowLeft, Clock, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const DetailView: React.FC = () => {
    const { profileId } = useParams<{ profileId: string }>();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeChunkId, setActiveChunkId] = useState<number | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [noteDraft, setNoteDraft] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);

    const audioRef = useRef<HTMLAudioElement>(null);
    const notesDebounceRef = useRef<NodeJS.Timeout | null>(null);

    // Assuming first recording for now
    const recording = profile?.recordings[0];
    const chunks = recording?.chunks || [];

    useEffect(() => {
        if (profileId) {
            fetchProfile(Number(profileId));
        }
    }, [profileId]);

    useEffect(() => {
        // Find active chunk based on time
        if (!recording) return;

        const currentChunk = chunks.find(
            c => currentTime >= c.start_time && currentTime < c.end_time
        );

        // If we found a chunk and it's different, update state
        // If we didn't find one (e.g. at the very end or silence), maybe keep last or null
        if (currentChunk && currentChunk.id !== activeChunkId) {
            setActiveChunkId(currentChunk.id);
            // Also update note draft to match the new chunk's note
            setNoteDraft(currentChunk.user_note || '');
        }
    }, [currentTime, recording, chunks]);

    // Handle manual chunk selection change to update note draft
    useEffect(() => {
        if (activeChunkId) {
            const chunk = chunks.find(c => c.id === activeChunkId);
            if (chunk) {
                setNoteDraft(chunk.user_note || '');
            }
        }
    }, [activeChunkId]);

    const fetchProfile = async (id: number) => {
        try {
            const data = await getProfile(id);
            setProfile(data);
            if (data.recordings.length > 0 && data.recordings[0].chunks.length > 0) {
                const firstChunk = data.recordings[0].chunks[0];
                setActiveChunkId(firstChunk.id);
                setNoteDraft(firstChunk.user_note || '');
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

    const handleChunkClick = (chunk: Chunk) => {
        if (audioRef.current) {
            audioRef.current.currentTime = chunk.start_time;
            audioRef.current.play();
            setActiveChunkId(chunk.id);
        }
    };

    const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newNote = e.target.value;
        setNoteDraft(newNote);

        // Optimistic update locally
        if (profile && activeChunkId) {
             const updatedRecordings = profile.recordings.map(r => ({
                ...r,
                chunks: r.chunks.map(c =>
                    c.id === activeChunkId ? { ...c, user_note: newNote } : c
                )
             }));
             setProfile({ ...profile, recordings: updatedRecordings });
        }

        // Debounced save
        if (notesDebounceRef.current) {
            clearTimeout(notesDebounceRef.current);
        }

        notesDebounceRef.current = setTimeout(async () => {
             if (activeChunkId) {
                 setIsSavingNote(true);
                 try {
                     await updateChunkNote(activeChunkId, newNote);
                 } catch (err) {
                     console.error("Failed to save note", err);
                 } finally {
                     setIsSavingNote(false);
                 }
             }
        }, 1000);
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    if (loading) return <div className="p-8 text-center">Loading...</div>;
    if (!profile) return <div className="p-8 text-center text-red-500">Profile not found</div>;

    // Construct audio URL. Ideally backend provides full URL or we prepend base.
    // backend saves as uploads/filename. backend mounts uploads at /static
    // recording.file_path is "uploads/uuid.ext" or absolute path.
    // We need to extract filename.
    const audioFilename = recording?.file_path.split('/').pop();
    const audioUrl = `http://localhost:8000/static/${audioFilename}`;

    const activeChunk = chunks.find(c => c.id === activeChunkId);

    return (
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center shadow-sm z-10">
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

            <div className="flex flex-1 overflow-hidden">
                {/* Left: Navigation (Titles) */}
                <aside className="w-1/4 bg-white border-r border-gray-200 overflow-y-auto">
                    <div className="p-4">
                        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                            Chapters
                        </h2>
                        <ul className="space-y-1">
                            {chunks.map((chunk) => (
                                <li key={chunk.id}>
                                    <button
                                        onClick={() => handleChunkClick(chunk)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-md text-sm transition flex items-center group",
                                            chunk.id === activeChunkId
                                                ? "bg-blue-50 text-blue-700 font-medium"
                                                : "text-gray-700 hover:bg-gray-100"
                                        )}
                                    >
                                        <span className={cn(
                                            "mr-2 text-xs",
                                            chunk.id === activeChunkId ? "text-blue-500" : "text-gray-400"
                                        )}>
                                            {formatTime(chunk.start_time)}
                                        </span>
                                        <span className="truncate">{chunk.title}</span>
                                        {chunk.id === activeChunkId && (
                                            <ChevronRight size={14} className="ml-auto" />
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </aside>

                {/* Center: Player & Transcript */}
                <main className="flex-1 flex flex-col bg-white overflow-hidden relative">
                    {/* Audio Player Sticky Header */}
                    <div className="bg-gray-50 border-b border-gray-200 p-4">
                         <audio
                            ref={audioRef}
                            src={audioUrl}
                            controls
                            className="w-full"
                            onTimeUpdate={handleTimeUpdate}
                         />
                    </div>

                    {/* Transcript Stream */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                        {chunks.map((chunk) => (
                            <div
                                key={chunk.id}
                                id={`chunk-${chunk.id}`}
                                className={cn(
                                    "p-4 rounded-lg transition border",
                                    chunk.id === activeChunkId
                                        ? "bg-blue-50 border-blue-100 shadow-sm"
                                        : "bg-transparent border-transparent hover:bg-gray-50"
                                )}
                                onClick={() => handleChunkClick(chunk)} // Click text to jump
                            >
                                <div className="flex items-center mb-2">
                                     <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                        {formatTime(chunk.start_time)} - {formatTime(chunk.end_time)}
                                     </span>
                                     <h3 className="ml-3 font-semibold text-gray-800 text-sm">{chunk.title}</h3>
                                </div>
                                <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                                    {chunk.transcript}
                                </p>
                            </div>
                        ))}
                    </div>
                </main>

                {/* Right: Notes */}
                <aside className="w-1/4 bg-gray-50 border-l border-gray-200 flex flex-col">
                    <div className="p-4 border-b border-gray-200 bg-white">
                        <h2 className="font-semibold text-gray-800 flex items-center">
                            <span className="bg-yellow-100 text-yellow-800 p-1 rounded mr-2">
                                📝
                            </span>
                            Notes
                        </h2>
                        {activeChunk && (
                            <p className="text-xs text-gray-500 mt-1 truncate">
                                For: {activeChunk.title}
                            </p>
                        )}
                    </div>
                    <div className="flex-1 p-4">
                        {activeChunkId ? (
                            <textarea
                                className="w-full h-full p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white shadow-inner text-sm leading-relaxed"
                                placeholder="Write your notes for this section here..."
                                value={noteDraft}
                                onChange={handleNoteChange}
                            />
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400 text-sm text-center">
                                Play or select a chunk <br/>to start taking notes.
                            </div>
                        )}
                    </div>
                    <div className="p-2 text-center text-xs text-gray-400 bg-white border-t border-gray-200">
                        {isSavingNote ? "Saving..." : "Auto-saved"}
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default DetailView;
