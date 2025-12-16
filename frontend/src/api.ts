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
}

export interface Recording {
  id: number;
  profile_id: number;
  file_path: string;
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

export const updateChunkNote = async (chunkId: number, note: string) => {
  const response = await api.patch<Chunk>(`/chunks/${chunkId}`, { user_note: note });
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
