// Utility function to capitalize the first letter of each word in a string
export const capitalizeWords = (str) => {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
};

// Format display name with capitalization
export const formatDisplayName = (name) => {
  if (!name) return 'Unknown';
  if (name === 'You') return name; // Keep "You" as is
  return capitalizeWords(name);
};
