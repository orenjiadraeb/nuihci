import React, { useState, useRef } from 'react';
import { storage } from '../firebase-config';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export const ProfilePictureUpload = ({ userId, onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setUploadProgress(0);

      // Create a reference to the profile picture in Firebase Storage
      const storageRef = ref(storage, `profile-pictures/${userId}`);

      // Simulate progress (Firebase Storage doesn't provide real progress in basic usage)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 30;
        });
      }, 200);

      // Upload the file
      const snapshot = await uploadBytes(storageRef, file);
      clearInterval(progressInterval);
      setUploadProgress(100);

      // Get download URL
      const downloadURL = await getDownloadURL(snapshot.ref);

      // Call success callback with the URL
      onUploadSuccess?.(downloadURL);

      // Reset after success
      setTimeout(() => {
        setUploadProgress(0);
        setUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 1000);
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="profile-picture-upload">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        disabled={uploading}
        className="profile-picture-upload__input"
        aria-label="Upload profile picture"
      />
      
      <button
        className="profile-picture-upload__button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        aria-busy={uploading}
      >
        {uploading ? `Uploading ${Math.round(uploadProgress)}%` : 'Change Picture'}
      </button>

      {uploading && (
        <div className="profile-picture-upload__progress">
          <div
            className="profile-picture-upload__progress-bar"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {error && (
        <div className="profile-picture-upload__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};
