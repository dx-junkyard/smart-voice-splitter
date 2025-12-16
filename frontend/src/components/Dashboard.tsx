import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getProfiles, type Profile, uploadFile } from '../api';
import { Calendar, FileText, Upload, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const Dashboard: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      const data = await getProfiles();
      // Sort by recorded_at desc
      data.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
      setProfiles(data);
    } catch (error) {
      console.error('Failed to fetch profiles', error);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800">Smart Voice Splitter</h1>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Upload size={20} />
          New Upload
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.map((profile) => (
          <Link
            to={`/profiles/${profile.id}`}
            key={profile.id}
            className="block bg-white rounded-xl shadow-md hover:shadow-lg transition p-6 border border-gray-100"
          >
            <h2 className="text-xl font-semibold mb-2 text-gray-800">{profile.title}</h2>
            <div className="flex items-center text-gray-500 text-sm mb-4">
              <Calendar size={16} className="mr-2" />
              {new Date(profile.recorded_at).toLocaleString()}
            </div>
            {profile.summary && (
              <p className="text-gray-600 line-clamp-3 text-sm">{profile.summary}</p>
            )}
            <div className="mt-4 flex items-center text-blue-600 text-sm font-medium">
                <FileText size={16} className="mr-1" />
                View Details
            </div>
          </Link>
        ))}
        {profiles.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-500">
                No recordings found. Start by uploading a new file.
            </div>
        )}
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
    </div>
  );
};

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
        setError("Please fill in all required fields.");
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
      console.error("Upload failed", err);
      setError("Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 w-full max-w-lg relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
          <X size={24} />
        </button>
        <h2 className="text-2xl font-bold mb-6">Upload New Recording</h2>

        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recorded At *</label>
            <input
              type="datetime-local"
              required
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Audio File *</label>
            <input
              type="file"
              required
              accept="audio/*"
              onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
              className="w-full border border-gray-300 rounded-lg p-2"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full text-white py-2 rounded-lg font-semibold transition",
              loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {loading ? "AI is processing audio..." : "Upload & Process"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Dashboard;
