import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000'; // Adjust as needed based on Docker/Local setup

export const api = axios.create({
  baseURL: API_BASE_URL,
});

export interface Chunk {
  id: number;
  recording_id: number;
  title: string;
  transcript: string;
  start_time: number;
  end_time: number;
  user_note: string | null;
  is_bookmarked: boolean;
}

export interface Recording {
  id: number;
  profile_id: number;
  file_path: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  chunks: Chunk[];
}

export interface Profile {
  id: number;
  title: string;
  recorded_at: string;
  summary: string | null;
  created_at: string;
  recordings: Recording[];
}

export const getProfiles = async () => {
  const response = await api.get<Profile[]>('/profiles');
  return response.data;
};

export const getProfile = async (id: number) => {
  const response = await api.get<Profile>(`/profiles/${id}`);
  return response.data;
};

export const updateChunk = async (chunkId: number, updates: { user_note?: string; is_bookmarked?: boolean }) => {
  const response = await api.patch<Chunk>(`/chunks/${chunkId}`, updates);
  return response.data;
};

export const uploadFile = async (formData: FormData) => {
  // Note: ensure the backend URL and endpoint are correct
  const response = await api.post<Recording>('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

export const deleteProfile = async (id: number) => {
  await api.delete(`/profiles/${id}`);
};

export const retryProcessing = async (profileId: number) => {
  const response = await api.post<Recording>(`/profiles/${profileId}/retry`);
  return response.data;
};
