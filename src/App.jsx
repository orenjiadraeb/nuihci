import { useEffect, useRef, useState } from "react";
import { signInEmail, registerEmail, signInWithGoogle, signOutUser, getUserProfile, sendVerificationEmail, getUserByUsername, searchUsers, sendFriendRequest, getFriendRequests, acceptFriendRequest, rejectFriendRequest, getFriends, unfriend, createConversation, getConversations, listenToMessages, listenToConversations, postMessage } from "./firebaseService";
import "@mediapipe/camera_utils/camera_utils.js";
import "@mediapipe/hands/hands.js";
import "@mediapipe/face_mesh/face_mesh.js";
import "./App.css";
import ChatInterface from "./components/ChatInterface.jsx";
import { db } from "./firebaseConfig.js";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const HandsCtor = globalThis.Hands;
const CameraCtor = globalThis.Camera;
const FaceMeshCtor = globalThis.FaceMesh;
const HAND_CONNECTIONS = globalThis.HAND_CONNECTIONS;

const MEDIAPIPE_HANDS_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/";
const MEDIAPIPE_FACE_MESH_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/";

const INDEX_TIP = 8;
const MAX_FIELD_LENGTH = 24;

const ADMIN_USER = "OLDBUTGOLD";
const ADMIN_PASS = "admin";

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning!";
  if (hour < 18) return "Good Afternoon!";
  return "Good Evening!";
}

function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizePassword(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isFingerExtended(lm, tip, pip) {
  const w = lm[0];
  const dTip = Math.hypot(lm[tip].x - w.x, lm[tip].y - w.y);
  const dPip = Math.hypot(lm[pip].x - w.x, lm[pip].y - w.y);
  return dTip > dPip * 1.03;
}

function isFingerCurled(lm, tip, pip) {
  const w = lm[0];
  const dTip = Math.hypot(lm[tip].x - w.x, lm[tip].y - w.y);
  const dPip = Math.hypot(lm[pip].x - w.x, lm[pip].y - w.y);
  return dTip < dPip * 0.99;
}

function isOpenPalm(lm) {
  return (
    isFingerExtended(lm, 8, 6) &&
    isFingerExtended(lm, 12, 10) &&
    isFingerExtended(lm, 16, 14) &&
    isFingerExtended(lm, 20, 18)
  );
}

function palmFacing(lm) {
  const w = lm[0];
  const i = lm[5];
  const p = lm[17];
  const v1 = { x: i.x - w.x, y: i.y - w.y, z: i.z - w.z };
  const v2 = { x: p.x - w.x, y: p.y - w.y, z: p.z - w.z };
  const nz = v1.x * v2.y - v1.y * v2.x;
  const palm = [0, 5, 9, 13, 17];
  const tips = [4, 8, 12, 16, 20];
  const palmZ = palm.reduce((s, idx) => s + lm[idx].z, 0) / palm.length;
  const tipsZ = tips.reduce((s, idx) => s + lm[idx].z, 0) / tips.length;
  const depth = tipsZ - palmZ;
  if (Math.abs(depth) < 0.008) return "unknown";
  const frontLike = depth < 0;
  return frontLike ^ (nz > 0) ? "palm" : "back";
}

function isPointingPose(lm) {
  return (
    isFingerExtended(lm, 8, 6) &&
    isFingerCurled(lm, 12, 10) &&
    isFingerCurled(lm, 16, 14) &&
    isFingerCurled(lm, 20, 18)
  );
}

function isThumbsUp(lm) {
  const w = lm[0];
  const thumbTip = lm[4];
  const thumbIp = lm[3];
  const thumbMcp = lm[2];
  const indexMcp = lm[5];

  const thumbExtendedUp = thumbTip.y < thumbIp.y - 0.02 && thumbTip.y < thumbMcp.y - 0.01;
  const thumbSeparated = Math.abs(thumbTip.x - indexMcp.x) > 0.02;

  const indexCurled = lm[8].y > lm[6].y;
  const middleCurled = lm[12].y > lm[10].y;
  const ringCurled = lm[16].y > lm[14].y;
  const pinkyCurled = lm[20].y > lm[18].y;

  return thumbExtendedUp && thumbSeparated && indexCurled && middleCurled && ringCurled && pinkyCurled;
}

function isIndexPointingUp(lm) {
  const indexTip = lm[8];
  const indexPip = lm[6];
  const indexPointingUp = indexTip.y < indexPip.y - 0.05;
  const middleCurled = isFingerCurled(lm, 12, 10);
  const ringCurled = isFingerCurled(lm, 16, 14);
  const pinkyCurled = isFingerCurled(lm, 20, 18);
  return indexPointingUp && middleCurled && ringCurled && pinkyCurled;
}

function facePitch(lm) {
  const nose = lm[1];
  const le = lm[33];
  const re = lm[263];
  const eyeMidY = (le.y + re.y) / 2;
  const scale = Math.max(0.04, Math.hypot(re.x - le.x, re.y - le.y));
  return (nose.y - eyeMidY) / scale;
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const userRef = useRef(null);
  const passRef = useRef(null);
  const activeFieldRef = useRef(null);
  const pendingFieldRef = useRef(null);
  const usernameRef = useRef("");
  const passwordRef = useRef("");
  const isLoggedInRef = useRef(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpUsername, setSignUpUsername] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("");
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [showSignUpConfirmPassword, setShowSignUpConfirmPassword] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [pendingField, setPendingField] = useState(null);
  const [status, setStatus] = useState("Controls: Point to move, index up = speech, two open palms = delete, one thumb up = click, two thumbs up = login.");
  const [handsSeen, setHandsSeen] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isClicking, setIsClicking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentScreen, setCurrentScreen] = useState("home");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [profile, setProfile] = useState({
    picture: "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=",
    name: "Admin User",
    biography: "Welcome to NyoUI messaging dashboard.",
    status: "Online",
  });
  const [editingProfile, setEditingProfile] = useState(false);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  // Load notifications from localStorage or use defaults
  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('nui-notifications');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Convert legacy string notifications to object format
        return parsed.map((n, idx) => {
          if (typeof n === 'string') {
            return { 
              id: `legacy-${idx}-${Date.now()}`, 
              text: n, 
              timestamp: Date.now(), 
              type: 'info' 
            };
          }
          return n;
        });
      } catch (e) {
        console.log("Failed to parse saved notifications");
      }
    }
    return [
      { id: 'welcome-1', text: "Welcome back! Your dashboard is ready.", timestamp: Date.now(), type: 'info' },
      { id: 'welcome-2', text: "Tip: You can use controls for gesture input and speech.", timestamp: Date.now(), type: 'info' },
    ];
  });
  const [newFriendName, setNewFriendName] = useState("");
  const [friends, setFriends] = useState(["Ava", "Noah", "Mia"]);
  const [friendStatus, setFriendStatus] = useState({
    "Ava": { online: false, picture: "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=" },
    "Noah": { online: false, picture: "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=" },
    "Mia": { online: false, picture: "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=" },
  });
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [showGroupMemberSelect, setShowGroupMemberSelect] = useState(false);
  
  // Friend search and request state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  
  // Message listener cleanup
  const messageListenerRef = useRef(null);
  const conversationListenerRef = useRef(null);
  const [activeConversationId, setActiveConversationId] = useState("private-Ava");
  const [conversations, setConversations] = useState([
    {
      id: "private-Ava",
      type: "private",
      title: "Private: Ava",
      participants: ["You", "Ava"],
      messages: [
        { id: "m1", sender: "Ava", text: "Hi! Ready to chat?", time: new Date().toLocaleTimeString() },
      ],
    },
    {
      id: "private-Noah",
      type: "private",
      title: "Private: Noah",
      participants: ["You", "Noah"],
      messages: [],
    },
    {
      id: "private-Mia",
      type: "private",
      title: "Private: Mia",
      participants: ["You", "Mia"],
      messages: [],
    },
    {
      id: "group-team",
      type: "group",
      title: "Group: Team",
      participants: ["You", "Ava", "Noah"],
      messages: [
        { id: "m2", sender: "Noah", text: "Let us sync at 3 PM.", time: new Date().toLocaleTimeString() },
      ],
    },
  ]);

  const recognitionRef = useRef(null);
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const mouthGestureRef = useRef({ active: false, since: 0 });
  const isListeningRef = useRef(false);
  const ttsEnabledRef = useRef(ttsEnabled);
  const lastSpokenRef = useRef({ text: "", at: 0 });
  const hoverSpeakRef = useRef({ text: "", at: 0, element: null });
  const profileVideoRef = useRef(null);
  const profileCanvasRef = useRef(null);
  const smoothedCursorRef = useRef({ x: 50, y: 50 });

  // Helper to check if text looks like a time string
  const isTimeString = (text) => {
    // Matches patterns like "1:11 PM", "13:45", "12:30:45 AM", etc.
    const timePattern = /^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?$/;
    return timePattern.test(text.trim());
  };

  const speak = (text) => {
    if (!ttsEnabledRef.current || !window.speechSynthesis) return;
    // Don't speak while mic is listening
    if (isListeningRef.current) return;
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    // Don't read time strings
    if (isTimeString(cleanText)) return;
    const now = Date.now();
    if (lastSpokenRef.current.text === cleanText && now - lastSpokenRef.current.at < 800) return;
    lastSpokenRef.current = { text: cleanText, at: now };
    try {
      const msg = new SpeechSynthesisUtterance(cleanText);
      msg.lang = "en-US";
      msg.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(msg);
    } catch {
      // Ignore browser TTS errors silently.
    }
  };

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  activeFieldRef.current = activeField;
  pendingFieldRef.current = pendingField;

  const [currentUser, setCurrentUser] = useState(null);

  const handleLogin = async () => {
    const loginInput = String(username || usernameRef.current || "").trim();
    const passwordValue = String(password || passwordRef.current || "").trim();
    if (!loginInput || !passwordValue) {
      setStatus("Enter your email/username and password to log in.");
      return;
    }

    let email = loginInput;

    // If input doesn't look like an email, try to look up by username
    if (!loginInput.includes("@")) {
      try {
        const userData = await getUserByUsername(loginInput.toLowerCase());
        if (userData && userData.email) {
          email = userData.email;
        } else {
          // Username not found, try as email anyway
          setStatus("Username not found. Trying as email...");
        }
      } catch (error) {
        // Firestore lookup failed, continue with input as email
        console.log("Username lookup failed, trying as email:", error);
      }
    }

    try {
      const userCredential = await signInEmail(email, passwordValue);
      setCurrentUser(userCredential.user);

      // Try to get profile data, but handle Firestore permission errors
      let profileData = null;
      try {
        profileData = await getUserProfile(userCredential.user.uid);
      } catch (firestoreError) {
        console.log("Firestore profile read failed (permissions):", firestoreError);
        // Continue with basic profile from Firebase Auth
        profileData = {
          displayName: userCredential.user.displayName || userCredential.user.email?.split("@")[0] || "User",
          email: userCredential.user.email,
        };
      }

      // Check if this is the admin account
      const isAdmin = loginInput.toUpperCase() === ADMIN_USER || email.toUpperCase() === ADMIN_USER;

      if (!isAdmin) {
        // Reset to empty state for new users
        setProfile({
          picture: "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=",
          name: profileData?.displayName || "New User",
          biography: "Welcome to NyoUI! Add friends to start chatting.",
          status: "Online",
        });
        setFriends([]);
        setFriendStatus({});
        setConversations([]);
        addNotification({ 
          id: `signup-${Date.now()}`, 
          text: "Welcome to NyoUI! Your account is ready.", 
          timestamp: Date.now(), 
          type: 'signup' 
        });
      } else {
        // Keep defaults for admin
        setProfile((prev) => ({ ...prev, ...(profileData || {}) }));
      }

      setIsLoggedIn(true);
      setStatus(`Login successful! Welcome back, ${profileData?.displayName || "User"}.`);
      addNotification({ 
        id: `login-${Date.now()}`, 
        text: `${getTimeGreeting()} You logged in successfully.`, 
        timestamp: Date.now(), 
        type: 'login' 
      });
      speak(`${getTimeGreeting()} Welcome to your messaging dashboard.`);
    } catch (error) {
      // Try admin fallback
      if (email.toUpperCase() === ADMIN_USER && normalizePassword(passwordValue) === ADMIN_PASS) {
        setStatus("Login successful! Welcome, admin.");
        setIsLoggedIn(true);
        addNotification({ 
          id: `login-${Date.now()}`, 
          text: `${getTimeGreeting()} You logged in successfully.`, 
          timestamp: Date.now(), 
          type: 'login' 
        });
        speak(`${getTimeGreeting()} Welcome to your messaging dashboard.`);
      } else {
        const errorMsg = error?.message || "Unable to authenticate.";
        if (errorMsg.includes("user-not-found")) {
          setStatus("Account not found. Please sign up first.");
        } else if (errorMsg.includes("wrong-password")) {
          setStatus("Incorrect password. Please try again.");
        } else if (errorMsg.includes("invalid-email")) {
          setStatus("Invalid email format.");
        } else if (errorMsg.includes("invalid-credential")) {
          setStatus("Invalid email or password.");
        } else {
          setStatus(`Login failed: ${errorMsg}`);
        }
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOutUser();
    } catch {
      // ignore logout failures
    }
    setCurrentUser(null);
    setIsLoggedIn(false);
    setUsername("");
    setPassword("");
    setActiveField(null);
    setPendingField(null);
    setStatus("Logged out.");
  };

  const handleSignUp = async () => {
    const email = signUpEmail.trim();
    const displayName = signUpUsername.trim();
    const password = signUpPassword;
    const confirmPassword = signUpConfirmPassword;

    if (!email || !displayName || !password || !confirmPassword) {
      setStatus("Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setStatus("Password must be at least 6 characters.");
      return;
    }

    try {
      const userCredential = await registerEmail(email, password, displayName);
      setCurrentUser(userCredential.user);
      setVerificationSent(true);
      setStatus("Account created! Please check your email to verify your account.");
      speak("Account created. Please check your email for verification.");
    } catch (error) {
      setStatus(`Sign up failed: ${error?.message || "Unable to create account."}`);
    }
  };

  const resetSignUp = () => {
    setShowSignUp(false);
    setSignUpEmail("");
    setSignUpUsername("");
    setSignUpPassword("");
    setSignUpConfirmPassword("");
    setVerificationSent(false);
  };

  // Friend System Functions
  const handleSearchUsers = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await searchUsers(searchQuery.toLowerCase());
      // Filter out current user and existing friends
      const filteredResults = results.filter(user => 
        user.uid !== currentUser?.uid && !friends.some(f => f.uid === user.uid)
      );
      setSearchResults(filteredResults);
      setShowSearchResults(true);
      // Clear search input after searching
      setSearchQuery("");
    } catch (error) {
      setStatus("Search failed: " + (error?.message || "Unknown error"));
    }
    setIsSearching(false);
  };

  const handleSendFriendRequest = async (toUserId, toUsername) => {
    if (!currentUser?.uid) return;
    try {
      await sendFriendRequest(currentUser.uid, profile.name || currentUser.email, toUserId);
      setStatus(`Friend request sent to ${toUsername}!`);
      speak(`Friend request sent to ${toUsername}`);
      // Add outgoing notification
      addNotification({
        id: `friend-request-sent-${Date.now()}`,
        text: `You sent a friend request to ${toUsername}`,
        type: 'friend-request-outgoing',
        toUsername: toUsername,
        timestamp: Date.now()
      });
      // Remove from search results
      setSearchResults(prev => prev.filter(u => u.uid !== toUserId));
    } catch (error) {
      setStatus(error?.message || "Failed to send friend request");
    }
  };

  const handleAcceptRequest = async (requestId, fromUsername) => {
    try {
      await acceptFriendRequest(requestId);
      setStatus("Friend request accepted!");
      // Add notification
      addNotification({
        id: `friend-accepted-${Date.now()}`,
        text: `You are now friends with ${fromUsername || 'a user'}`,
        type: 'friend-accepted',
        timestamp: Date.now()
      });
      // Refresh friends and requests
      loadFriends();
      loadFriendRequests();
    } catch (error) {
      setStatus("Failed to accept request: " + (error?.message || "Unknown error"));
    }
  };

  const handleRejectRequest = async (requestId, fromUsername) => {
    try {
      await rejectFriendRequest(requestId);
      setStatus("Friend request rejected");
      // Add notification
      addNotification({
        id: `friend-rejected-${Date.now()}`,
        text: `You rejected friend request from ${fromUsername || 'a user'}`,
        type: 'friend-rejected',
        timestamp: Date.now()
      });
      loadFriendRequests();
    } catch (error) {
      setStatus("Failed to reject request: " + (error?.message || "Unknown error"));
    }
  };

  const loadFriends = async () => {
    if (!currentUser?.uid) return;
    try {
      const friendsList = await getFriends(currentUser.uid);
      setFriends(friendsList.map(f => f.displayName || f.email?.split("@")[0] || "Unknown"));
      // Update friendStatus with full friend objects for unfriend functionality
      const newFriendStatus = {};
      friendsList.forEach(f => {
        newFriendStatus[f.displayName || f.email?.split("@")[0]] = {
          online: false,
          picture: f.photoURL || "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=",
          uid: f.uid,
        };
      });
      setFriendStatus(newFriendStatus);
    } catch (error) {
      console.log("Failed to load friends:", error);
    }
  };

  const handleUnfriend = async (friendName) => {
    if (!currentUser?.uid) return;
    const friendUid = friendStatus[friendName]?.uid;
    if (!friendUid) {
      setStatus("Unable to unfriend: User not found");
      return;
    }
    
    try {
      await unfriend(currentUser.uid, friendUid);
      setStatus(`${friendName} removed from friends`);
      speak(`${friendName} removed from friends`);
      // Refresh friends list
      loadFriends();
    } catch (error) {
      setStatus("Failed to unfriend: " + (error?.message || "Unknown error"));
    }
  };

  const loadFriendRequests = async () => {
    if (!currentUser?.uid) return;
    try {
      const requests = await getFriendRequests(currentUser.uid);
      setFriendRequests(requests);
      // Add friend requests to notifications as objects with actions
      const requestNotifications = requests.map(r => ({
        id: `friend-request-${r.id}`,
        text: `Friend request from ${r.fromUsername}`,
        type: 'friend-request-incoming',
        requestId: r.id,
        fromUsername: r.fromUsername,
        timestamp: Date.now()
      }));
      
      setNotifications(prev => {
        // Remove old friend request notifications
        const filtered = prev.filter(n => 
          typeof n === 'string' ? !n.includes("Friend request from") : n.type !== 'friend-request-incoming'
        );
        // Only add new request notifications that don't already exist
        const existingIds = new Set(prev.map(n => n.id));
        const newNotifications = requestNotifications.filter(r => !existingIds.has(r.id));
        // Increment unread count and play sound for new notifications
        if (newNotifications.length > 0 && currentScreen !== "notifications") {
          setUnreadCount(count => count + newNotifications.length);
          // Play sound for new friend requests
          playNotificationSound();
        }
        return [...requestNotifications, ...filtered];
      });
    } catch (error) {
      console.log("Failed to load friend requests:", error);
    }
  };

  // Load friends and requests when logged in
  useEffect(() => {
    if (currentUser && isLoggedIn) {
      loadFriends();
      loadFriendRequests();
      loadConversations();
    }
  }, [currentUser, isLoggedIn]);

  // Save notifications to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('nui-notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Track unread notifications
  const [unreadCount, setUnreadCount] = useState(() => {
    const saved = localStorage.getItem('nui-unread-count');
    return saved ? parseInt(saved, 10) : 0;
  });

  // Sound notification preference
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('nui-sound-enabled');
    return saved !== null ? saved === 'true' : true; // Default to enabled
  });

  // Save sound preference
  useEffect(() => {
    localStorage.setItem('nui-sound-enabled', soundEnabled.toString());
  }, [soundEnabled]);

  // Notification sound using Web Audio API (generates a pleasant chime)
  const playNotificationSound = () => {
    if (!soundEnabled) return;
    
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Create a pleasant notification sound (two tones)
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.log("Failed to play notification sound:", error);
    }
  };

  // Save unread count to localStorage
  useEffect(() => {
    localStorage.setItem('nui-unread-count', unreadCount.toString());
  }, [unreadCount]);

  // Track unread messages per conversation
  const [unreadMessages, setUnreadMessages] = useState(() => {
    const saved = localStorage.getItem('nui-unread-messages');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.log("Failed to parse unread messages");
      }
    }
    return {};
  });

  // Save unread messages to localStorage
  useEffect(() => {
    localStorage.setItem('nui-unread-messages', JSON.stringify(unreadMessages));
  }, [unreadMessages]);

  // Reset unread count when opening notifications screen
  useEffect(() => {
    if (currentScreen === "notifications") {
      setUnreadCount(0);
    }
  }, [currentScreen]);

  // Helper function to add notification and increment unread count
  const addNotification = (notification) => {
    setNotifications(prev => [notification, ...prev]);
    // Only increment if not currently viewing notifications
    if (currentScreen !== "notifications") {
      setUnreadCount(prev => prev + 1);
      // Play notification sound
      playNotificationSound();
    }
  };

  // Helper to reset unread count for a conversation
  const resetUnreadCount = (conversationId) => {
    setUnreadMessages(prev => {
      const { [conversationId]: _, ...rest } = prev;
      return rest;
    });
  };

  // Listen to messages for active conversation
  useEffect(() => {
    console.log("Message listener useEffect triggered. activeConversationId:", activeConversationId, "currentUser:", !!currentUser);
    if (activeConversationId && currentUser) {
      // Clean up previous listener
      if (messageListenerRef.current) {
        messageListenerRef.current();
      }
      
      // Set up new listener
      console.log("Setting up message listener for:", activeConversationId);
      console.log("Current conversations:", conversations.map(c => c.id));
      messageListenerRef.current = listenToMessages(activeConversationId, (messages) => {
        console.log("Received messages from Firestore:", messages);
        console.log("Message count:", messages.length);
        setConversations(prev => {
          console.log("Current conversations before update:", prev.map(c => ({ id: c.id, msgCount: c.messages.length })));
          return prev.map(convo => {
            console.log("Checking conversation:", convo.id, "against", activeConversationId, "match:", convo.id === activeConversationId);
            if (convo.id === activeConversationId) {
              // Convert Firestore messages to local format
              const localMessages = messages.map(msg => ({
                id: msg.id,
                sender: msg.senderName === (profile.name || currentUser.email?.split("@")[0]) ? "You" : msg.senderName,
                text: msg.text,
                time: msg.createdAt?.toLocaleTimeString() || new Date().toLocaleTimeString(),
                type: (msg.type === "text" || !msg.type) ? "text" : msg.type, // Normalize type
                url: msg.attachments?.[0]?.url,
              }));
              console.log("Updated conversation messages:", localMessages);
              console.log("Conversation will have", localMessages.length, "messages");
              return { ...convo, messages: localMessages };
            }
            return convo;
          });
        });
      }, (error) => {
        console.error("Message listener error:", error);
        // If conversation doesn't exist, create it
        if (error.code === 'permission-denied' || error.message.includes('not found')) {
          console.log("Conversation doesn't exist, will be created on first message");
        }
      });
    } else {
      console.log("Message listener useEffect skipped. activeConversationId:", activeConversationId, "currentUser:", !!currentUser);
    }
    
    return () => {
      if (messageListenerRef.current) {
        messageListenerRef.current();
      }
    };
  }, [activeConversationId, currentUser, profile.name]);

  // Track unread messages for all conversations
  useEffect(() => {
    if (!currentUser) return;
    
    const unsubscribers = [];
    
    // Set up listeners for all conversations
    conversations.forEach(convo => {
      const unsub = listenToMessages(convo.id, (messages) => {
        // Count messages not from current user and not yet seen
        const myName = profile.name || currentUser.email?.split("@")[0] || "You";
        const myUid = currentUser.uid;
        
        // Get messages from others (not from me)
        const otherMessages = messages.filter(msg => 
          msg.senderName !== myName && msg.senderId !== myUid
        );
        
        // Only update unread count if we're not currently viewing this conversation
        // and if there are new messages
        if (activeConversationId !== convo.id && otherMessages.length > 0) {
          setUnreadMessages(prev => {
            const currentCount = prev[convo.id] || 0;
            // Only increment if message count increased
            if (otherMessages.length > currentCount) {
              // Play notification sound for new message
              playNotificationSound();
              return { ...prev, [convo.id]: otherMessages.length };
            }
            return prev;
          });
        }
      });
      
      unsubscribers.push(unsub);
    });
    
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [conversations, currentUser, profile.name, activeConversationId]);

  // Load conversations from Firestore
  const loadConversations = async () => {
    if (!currentUser?.uid) return;
    try {
      const firestoreConversations = await getConversations(currentUser.uid);
      console.log("Loaded conversations from Firestore:", firestoreConversations);
      // Merge with local conversations
      firestoreConversations.forEach(convo => {
        setConversations(prev => {
          const exists = prev.find(c => c.id === convo.id);
          if (!exists) {
            return [...prev, {
              id: convo.id,
              type: convo.type,
              title: convo.title,
              participants: convo.participants,
              messages: [],
            }];
          }
          return prev;
        });
      });
    } catch (error) {
      console.log("Failed to load conversations (may be normal for new users):", error);
      // Don't show error to user - it's normal if they have no conversations yet
    }
  };

  const updateProfileField = (key, value) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const updateProfilePictureFromFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Please select an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = String(reader.result || "");
      if (!imageData) return;
      setProfile((prev) => ({ ...prev, picture: imageData }));
      setStatus("Profile picture updated.");
      speak("Profile picture updated.");
    };
    reader.readAsDataURL(file);
  };

  const startCameraCapture = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera not supported on this device.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (profileVideoRef.current) {
        profileVideoRef.current.srcObject = stream;
        setShowCameraCapture(true);
      }
    } catch (error) {
      setStatus("Unable to access camera.");
    }
  };

  const captureProfilePicture = () => {
    const video = profileVideoRef.current;
    const canvas = profileCanvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const imageData = canvas.toDataURL("image/png");
    setProfile((prev) => ({ ...prev, picture: imageData }));
    setStatus("Profile picture captured.");
    speak("Profile picture captured.");

    // Stop the stream
    const stream = video.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setShowCameraCapture(false);
  };

  const cancelCameraCapture = () => {
    const video = profileVideoRef.current;
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
    }
    setShowCameraCapture(false);
  };

  const getTextToRead = (element) => {
    if (!element) return "";
    const explicit = element.getAttribute("data-tts");
    if (explicit) return explicit;
    const aria = element.getAttribute("aria-label");
    if (aria) return aria;
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      const labelText = element.closest("label")?.querySelector("span")?.textContent?.trim();
      const fallback = element.placeholder?.trim();
      return [labelText, fallback].filter(Boolean).join(". ");
    }
    if (element.tagName === "SELECT") {
      const labelText = element.closest("label")?.querySelector("span")?.textContent?.trim();
      return labelText || "Status selection";
    }
    return element.textContent?.trim() || "";
  };

  const handleSpeakFromEvent = (event) => {
    if (!ttsEnabledRef.current) return;
    // Don't speak while mic is listening
    if (isListeningRef.current) return;
    // Only speak for clickable/interactive elements (same as hover)
    const target = event.target.closest(
      "[data-tts], button, input, textarea, select, a, [role='button'], [onclick]"
    );
    if (!target) return;
    const text = getTextToRead(target);
    if (text) speak(text);
  };

  // Check if element is a chat message
  const isChatMessage = (element) => {
    return element.closest('.direct-message, .message-bubble') !== null;
  };

  // Get chat message text (sender + message)
  const getChatMessageText = (element) => {
    const msgElement = element.closest('.direct-message, .message-bubble');
    if (!msgElement) return null;
    
    const sender = msgElement.querySelector('.message-sender')?.textContent?.trim();
    const text = msgElement.querySelector('.message-text')?.textContent?.trim();
    
    if (sender && text) {
      return `${sender}: ${text}`;
    }
    return null;
  };

  const speakHoveredElement = (element) => {
    if (!ttsEnabledRef.current || !element) return;
    // Don't speak while mic is listening
    if (isListeningRef.current) return;
    
    // Check if it's a chat message first
    if (isChatMessage(element)) {
      const chatText = getChatMessageText(element);
      if (chatText) {
        const now = Date.now();
        if (hoverSpeakRef.current.text === chatText && now - hoverSpeakRef.current.at < 1000) return;
        hoverSpeakRef.current = { element, text: chatText, at: now };
        speak(chatText);
      }
      return;
    }
    
    // Only read clickable/interactive elements
    const clickableTarget = element.closest(
      "[data-tts], button, input, textarea, select, a, [role='button'], [onclick]"
    );
    if (!clickableTarget) return;
    
    const text = getTextToRead(clickableTarget);
    if (!text) return;
    const now = Date.now();
    const isSameElement = hoverSpeakRef.current.element === clickableTarget;
    const isSameText = hoverSpeakRef.current.text === text;
    if ((isSameElement || isSameText) && now - hoverSpeakRef.current.at < 1000) return;
    hoverSpeakRef.current = { element: clickableTarget, text, at: now };
    speak(text);
  };

  const addFriend = () => {
    const clean = newFriendName.trim();
    if (!clean) return;
    if (friends.some((friend) => friend.toLowerCase() === clean.toLowerCase())) {
      setStatus(`${clean} is already in your friends list.`);
      return;
    }
    const newConversation = {
      id: `private-${clean}`,
      type: "private",
      title: `Private: ${clean}`,
      participants: ["You", clean],
      messages: [],
    };

    setFriends((prev) => [...prev, clean]);
    setFriendStatus((prev) => ({
      ...prev,
      [clean]: { online: true, picture: "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM=" },
    }));
    setConversations((prev) => [...prev, newConversation]);
    addNotification({ 
      id: `friend-added-${Date.now()}`, 
      text: `${clean} added to your friends list.`, 
      timestamp: Date.now(), 
      type: 'friend-added' 
    });
    setNewFriendName("");
    setStatus(`${clean} added as friend.`);
    speak(`${clean} added as friend.`);

    if (db) {
      const convoRef = doc(db, "conversations", newConversation.id);
      setDoc(convoRef, {
        ...newConversation,
        updatedAt: serverTimestamp(),
      }).catch(() => {
        /* quietly ignore firestore write failure */
      });
    }
  };

  const removeFriend = (friendName) => {
    setFriends((prev) => prev.filter((friend) => friend !== friendName));
    setFriendStatus((prev) => {
      const { [friendName]: _, ...rest } = prev;
      return rest;
    });
    setConversations((prev) => prev.filter((convo) => convo.id !== `private-${friendName}`));
    if (activeConversationId === `private-${friendName}`) {
      setActiveConversationId("group-team");
    }
    addNotification({ 
      id: `friend-removed-${Date.now()}`, 
      text: `${friendName} removed from friends list.`, 
      timestamp: Date.now(), 
      type: 'friend-removed' 
    });
    setStatus(`${friendName} removed from friends list.`);
  };

  const createGroupChat = async () => {
    const clean = newGroupName.trim();
    if (!clean) {
      setStatus("Enter a group name first.");
      return;
    }
    if (selectedGroupMembers.length === 0) {
      setStatus("Select at least one friend to add.");
      return;
    }
    const id = `group-${clean.toLowerCase().replace(/\s+/g, "-")}`;
    if (conversations.some((conversation) => conversation.id === id)) {
      setStatus("Group chat name already exists.");
      return;
    }

    // Get participant UIDs
    const participantUids = selectedGroupMembers.map(m => friendStatus[m]?.uid).filter(Boolean);
    if (currentUser) {
      participantUids.push(currentUser.uid);
    }

    const newConversation = {
      id,
      type: "group",
      title: `Group: ${clean}`,
      participants: ["You", ...selectedGroupMembers],
      participantUids, // Store UIDs for Firestore
      messages: [],
    };

    setConversations((prev) => [...prev, newConversation]);
    setActiveConversationId(id);
    setNewGroupName("");
    setSelectedGroupMembers([]);
    setShowGroupMemberSelect(false);
    setShowChat(true);
    addNotification({ 
      id: `group-created-${Date.now()}`, 
      text: `Group chat "${clean}" created.`, 
      timestamp: Date.now(), 
      type: 'group-created' 
    });
    setStatus(`Created group chat: ${clean}`);
    speak(`Group chat ${clean} created.`);

    // Store in Firestore
    if (currentUser && participantUids.length > 0) {
      try {
        await createConversation({
          id,
          type: "group",
          title: `Group: ${clean}`,
          participants: participantUids,
        });
      } catch (error) {
        console.log("Failed to create group in Firestore:", error);
      }
    }
  };

  const leaveGroupChat = (groupId) => {
    setConversations((prev) => prev.filter((c) => c.id !== groupId));
    if (activeConversationId === groupId) {
      setActiveConversationId("");
      setShowChat(false);
    }
    const groupTitle = conversations.find((c) => c.id === groupId)?.title || "Group";
    addNotification({ 
      id: `group-left-${Date.now()}`, 
      text: `You left ${groupTitle}.`, 
      timestamp: Date.now(), 
      type: 'group-left' 
    });
    setStatus(`Left ${groupTitle}`);
    speak(`You left the group`);
  };

  const sendMessage = async (payload) => {
    const messageId = payload?.id || `${activeConversationId}-${Date.now()}`;
    const timestamp = payload?.time || new Date().toLocaleTimeString();
    const text = String(payload?.text ?? chatMessage).trim();

    if (!text && payload?.type !== "image" && payload?.type !== "file") return;

    const message = {
      id: messageId,
      sender: "You",
      type: payload?.type || "text",
      text: payload?.text ?? text,
      time: timestamp,
      status: payload?.status || "sent",
      replyTo: payload?.replyTo,
      url: payload?.url,
      alt: payload?.alt,
      filename: payload?.filename,
      localTime: payload?.localTime || Date.now(),
    };

    // Update local state immediately (show message to user)
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, message],
            }
          : conversation,
      ),
    );

    if (!payload || payload.type === "text") {
      setChatMessage("");
    }

    setStatus("Message sent.");
    speak(`Message sent: ${message.text || message.filename || "an attachment"}`);

    // Send to Firestore (async, doesn't block UI)
    if (currentUser && activeConversationId) {
      try {
        await postMessage(activeConversationId, {
          text: text,
          senderId: currentUser.uid,
          senderName: profile.name || currentUser.email?.split("@")[0] || "You",
          type: payload?.type || "text",
          attachments: payload?.url ? [{ url: payload.url, type: payload.type }] : [],
        });
        console.log("Message sent to Firestore successfully");
      } catch (error) {
        console.error("Failed to send message to Firestore:", error);
        setStatus("Message sent locally (sync may be delayed)");
      }
    }
  };

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;
    if (!HandsCtor || !CameraCtor || !FaceMeshCtor) return undefined;

    let disposed = false;
    const ctx = canvas.getContext("2d");

    let nodBaseline = null;
    let nodSmooth = null;
    let nodState = "idle";
    let nodPeak = 0;
    let nodRef = 0;
    let nodAt = 0;
    let nodCooldownUntil = 0;

    const latestPrimary = { hand: null, handedness: null };
    let secondaryHand = null;
    let clickCooldownUntil = 0;
    let latestFaceLm = null;

    const drawOverlay = () => {
      if (disposed) return;
      const cw = video.videoWidth || 1280;
      const ch = video.videoHeight || 720;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.clearRect(0, 0, cw, ch);
    };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        setStatus("Listening... Speak now.");
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onresult = (event) => {
        const results = event.results;
        if (results.length > 0) {
          const lastResult = results[results.length - 1];
          const text = lastResult[0].transcript;
          if (lastResult.isFinal) {
            const cleanText = text.trim();
            const activeElement = document.activeElement;

            if (activeElement && activeElement.tagName === "INPUT") {
              const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
              const nativeSetter = descriptor?.set;
              if (nativeSetter) {
                const currentValue = activeElement.value;
                const start = activeElement.selectionStart || activeElement.value.length;
                const end = activeElement.selectionEnd || activeElement.value.length;
                let insertText = cleanText;
                const placeholder = activeElement.getAttribute("placeholder") || "";
                if (placeholder.includes("USERNAME")) {
                  insertText = cleanText.toUpperCase().replace(/[^A-Z0-9]/g, "");
                } else if (placeholder.includes("PASSWORD")) {
                  insertText = cleanText.replace(/[^a-zA-Z0-9]/g, "");
                }
                const newValue = currentValue.slice(0, start) + insertText + currentValue.slice(end);
                nativeSetter.call(activeElement, newValue);
                activeElement.selectionStart = activeElement.selectionEnd = start + insertText.length;
                activeElement.dispatchEvent(new Event("input", { bubbles: true }));
              }
              setStatus(`Speech recognized: "${cleanText}"`);
            } else if (activeFieldRef.current) {
              const field = activeFieldRef.current;
              let typedText = "";
              if (field === "username") {
                typedText = cleanText.toUpperCase().replace(/[^A-Z0-9]/g, "");
                setUsername((prev) => (prev + typedText).slice(0, MAX_FIELD_LENGTH));
              } else if (field === "password") {
                typedText = cleanText.replace(/[^a-zA-Z0-9]/g, "");
                setPassword((prev) => (prev + typedText).slice(0, MAX_FIELD_LENGTH));
              }
              setStatus(`Speech recognized: "${typedText}"`);
            }
          }
        }
      };

      recognitionRef.current.onerror = (event) => {
        if (event.error !== "aborted") {
          setIsListening(false);
        }
      };
    }

    const confirmSelection = () => {
      const field = pendingFieldRef.current;
      if (!field) return;
      setActiveField(field);
      setStatus(
        field === "username"
          ? "Username active. Click, index up to speak, two palms to delete, or two thumbs up to login."
          : "Password active. Click, index up to speak, two palms to delete, or two thumbs up to login.",
      );
      if (field === "username") userRef.current?.focus();
      if (field === "password") passRef.current?.focus();
      setPendingField(null);
    };

    const detectNod = (faceLm) => {
      const now = performance.now();
      const pitch = facePitch(faceLm);
      nodSmooth = nodSmooth === null ? pitch : 0.34 * pitch + 0.66 * nodSmooth;
      if (nodState === "idle") {
        nodBaseline = nodBaseline === null ? pitch : 0.05 * pitch + 0.95 * nodBaseline;
        if (now >= nodCooldownUntil && nodSmooth > nodBaseline + 0.08) {
          nodState = "armed";
          nodAt = now;
          nodRef = nodBaseline;
          nodPeak = nodSmooth;
        }
      } else {
        if (nodSmooth > nodPeak) nodPeak = nodSmooth;
        const timedOut = now - nodAt > 1200;
        const complete = nodPeak > nodRef + 0.05 && nodPeak - nodSmooth > 0.058;
        if (complete) {
          confirmSelection();
          nodState = "idle";
          nodCooldownUntil = now + 320;
          nodBaseline = nodSmooth;
        } else if (timedOut) {
          nodState = "idle";
          nodCooldownUntil = now + 240;
        }
      }
    };

    const hands = new HandsCtor({
      locateFile: (file) => `${MEDIAPIPE_HANDS_BASE}${file}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.6,
    });
    hands.onResults((results) => {
      if (disposed) return;
      const handsCount = results.multiHandLandmarks?.length ?? 0;
      setHandsSeen(handsCount);

      const now = performance.now();

      let pointingHand = null;
      let clickHand = null;
      let thumbsUpCount = 0;

      for (let i = 0; i < handsCount; i++) {
        const lm = results.multiHandLandmarks[i];
        if (isPointingPose(lm)) {
          pointingHand = lm;
        } else if (isThumbsUp(lm)) {
          clickHand = lm;
          thumbsUpCount += 1;
        }
      }

      latestPrimary.hand = pointingHand;
      secondaryHand = clickHand;

      if (pointingHand) {
        const tipX = 1 - pointingHand[INDEX_TIP].x;
        const tipY = pointingHand[INDEX_TIP].y;
        const targetX = tipX * 100;
        const targetY = tipY * 100;
        const alpha = 0.35;
        smoothedCursorRef.current.x = smoothedCursorRef.current.x * (1 - alpha) + targetX * alpha;
        smoothedCursorRef.current.y = smoothedCursorRef.current.y * (1 - alpha) + targetY * alpha;
        setCursorPos({ x: smoothedCursorRef.current.x, y: smoothedCursorRef.current.y });
        const hoverX = tipX * window.innerWidth;
        const hoverY = tipY * window.innerHeight;
        const hoveredElement = document.elementFromPoint(hoverX, hoverY);
        speakHoveredElement(hoveredElement);

        const speechGesture = isIndexPointingUp(pointingHand) && document.activeElement?.tagName === "INPUT";
        if (speechGesture) {
          if (!mouthGestureRef.current.active) {
            mouthGestureRef.current = { active: true, since: now };
            if (recognitionRef.current && !isListeningRef.current) {
              try { recognitionRef.current.start(); } catch {}
            }
          }
        } else {
          if (mouthGestureRef.current.active) {
            mouthGestureRef.current = { active: false, since: 0 };
            if (recognitionRef.current && isListeningRef.current) {
              try { recognitionRef.current.stop(); } catch {}
            }
          }
        }

        if (clickHand && now >= clickCooldownUntil) {
          setIsClicking(true);
          clickCooldownUntil = now + 500;
          setTimeout(() => setIsClicking(false), 200);

          const screenX = tipX * window.innerWidth;
          const screenY = tipY * window.innerHeight;
          const element = document.elementFromPoint(screenX, screenY);

          if (element) {
            let targetElement = element;
            let buttonElement = element.closest("button");

            if (buttonElement) {
              targetElement = buttonElement;
              buttonElement.click();
              setStatus(`Clicked: ${buttonElement.textContent.trim()}`);
            } else {
              const mousedown = new MouseEvent("mousedown", {
                bubbles: true,
                cancelable: true,
                clientX: screenX,
                clientY: screenY,
              });
              const mouseup = new MouseEvent("mouseup", {
                bubbles: true,
                cancelable: true,
                clientX: screenX,
                clientY: screenY,
              });
              const click = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                clientX: screenX,
                clientY: screenY,
              });
              element.dispatchEvent(mousedown);
              element.dispatchEvent(mouseup);
              element.dispatchEvent(click);
              element.focus?.();
              setStatus(`Clicked: ${element.tagName.toLowerCase()}${element.id ? "#" + element.id : ""}`);
            }
          }
        }
      }

      const twoOpenPalmsFacingCamera = handsCount === 2 &&
        results.multiHandLandmarks.every((lm) => isOpenPalm(lm) && palmFacing(lm) === "palm");

      if (twoOpenPalmsFacingCamera && now >= clickCooldownUntil) {
        clickCooldownUntil = now + 400;
        const activeElement = document.activeElement;
        if (activeElement && activeElement.tagName === "INPUT") {
          const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
          const nativeSetter = descriptor?.set;
          if (nativeSetter) {
            const currentValue = activeElement.value;
            const cursorPos = activeElement.selectionStart || currentValue.length;
            const textBeforeCursor = currentValue.slice(0, cursorPos);
            const match = textBeforeCursor.match(/(\S+\s*)$/);
            const wordLength = match ? match[0].length : 0;
            const newValue = currentValue.slice(0, cursorPos - wordLength) + currentValue.slice(cursorPos);
            nativeSetter.call(activeElement, newValue);
            activeElement.selectionStart = activeElement.selectionEnd = cursorPos - wordLength;
            activeElement.dispatchEvent(new Event("input", { bubbles: true }));
          }
          setStatus("Deleted last word");
        } else if (activeFieldRef.current) {
          const field = activeFieldRef.current;
          if (field === "username") {
            setUsername((prev) => {
              const match = prev.match(/(\S+\s*)$/);
              const wordLength = match ? match[0].length : 0;
              return prev.slice(0, -wordLength);
            });
            setStatus("Deleted last word from username");
          } else if (field === "password") {
            setPassword((prev) => {
              const match = prev.match(/(\S+\s*)$/);
              const wordLength = match ? match[0].length : 0;
              return prev.slice(0, -wordLength);
            });
            setStatus("Deleted last word from password");
          }
        }
      }

      if (thumbsUpCount === 2 && now >= clickCooldownUntil) {
        clickCooldownUntil = now + 600;
        setIsClicking(true);
        setTimeout(() => setIsClicking(false), 300);

        if (!isLoggedInRef.current) {
          handleLogin();
        } else {
          const activeElement = document.activeElement;
          const placeholder = activeElement?.getAttribute("placeholder") || "";
          const ariaLabel = activeElement?.getAttribute("aria-label") || "";

          if (placeholder.includes("message") || ariaLabel.includes("message")) {
            if (chatMessage.trim()) {
              sendMessage();
              setStatus("Message sent with double thumbs up");
            }
          } else if (placeholder.includes("group") || ariaLabel.includes("group")) {
            if (newGroupName.trim()) {
              createGroupChat();
              setStatus("Group chat created with double thumbs up");
            }
          } else if (placeholder.includes("friend") || ariaLabel.includes("friend")) {
            if (newFriendName.trim()) {
              addFriend();
              setStatus("Friend added with double thumbs up");
            }
          }
        }
      }

      if (!pointingHand) {
        if (mouthGestureRef.current.active) {
          mouthGestureRef.current = { active: false, since: 0 };
          if (recognitionRef.current && isListeningRef.current) {
            try { recognitionRef.current.stop(); } catch {}
          }
        }
        if (!isLoggedInRef.current && handsCount > 0) {
          const lm = results.multiHandLandmarks[0];
          const open = isOpenPalm(lm);
          const side = palmFacing(lm);
          if (open && side === "palm" && pendingFieldRef.current !== "username") {
            setPendingField("username");
            setStatus("Open palm = Username field. Nod to confirm.");
          } else if (open && side === "back" && pendingFieldRef.current !== "password") {
            setPendingField("password");
            setStatus("Back of hand = Password field. Nod to confirm.");
          }
        }
      }

      drawOverlay();
    });

    const faceMesh = new FaceMeshCtor({
      locateFile: (file) => `${MEDIAPIPE_FACE_MESH_BASE}${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults((results) => {
      if (disposed) return;
      const lm = results.multiFaceLandmarks?.[0];
      if (lm) {
        latestFaceLm = lm;
        detectNod(lm);
      }
    });

    const camera = new CameraCtor(video, {
      onFrame: async () => {
        if (disposed) return;
        await hands.send({ image: video });
        await faceMesh.send({ image: video });
      },
      width: 1280,
      height: 720,
      facingMode: "user",
    });

    camera.start().catch(() => {
      setStatus("Unable to access camera. Allow webcam permission and refresh.");
    });

    return () => {
      disposed = true;
      camera.stop();
      hands.close();
      faceMesh.close();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event) => {
      const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
      speakHoveredElement(hoveredElement);
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <main
      className="nyoui-screen"
      onMouseOver={handleSpeakFromEvent}
      onFocusCapture={handleSpeakFromEvent}
      onClickCapture={handleSpeakFromEvent}
    >
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <div className="ambient ambient--three" />

      {isLoggedIn ? (
        <>
          <section className="app-screen" aria-label="App screen">
            {/* Header */}
            <header className="app-header">
              <div className="header-left">
                <button type="button" className="header-btn" onClick={() => setShowGuide(true)}>Settings</button>
              </div>
              <div className="header-center">
                <h2>NyoUI</h2>
              </div>
              <div className="header-right">
                <button type="button" className="header-btn danger" onClick={handleLogout}>Logout</button>
              </div>
            </header>

            {/* Main Content */}
            <main className="app-main">
              {currentScreen === "profile" && (
                <section className="screen profile-screen" aria-label="Profile screen">
                  <h2>User Profile</h2>
                  <div className="profile-card">
                    <img className="profile-picture-large" src={profile.picture || "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM="} alt={`${profile.name} profile`} />

                    {editingProfile ? (
                      <>
                        <input
                          type="text"
                          value={profile.name}
                          onChange={(e) => updateProfileField("name", e.target.value)}
                          placeholder="Name"
                          aria-label="Profile name"
                        />
                        <input
                          type="text"
                          value={profile.biography}
                          onChange={(e) => updateProfileField("biography", e.target.value)}
                          placeholder="Biography"
                          aria-label="Profile biography"
                        />
                        <div className="profile-media-actions">
                          <button
                            type="button"
                            onClick={() => uploadInputRef.current?.click()}
                            data-tts="Upload profile picture"
                          >
                            Upload Picture
                          </button>
                          <button
                            type="button"
                            onClick={startCameraCapture}
                            data-tts="Take profile picture"
                          >
                            Take Picture
                          </button>
                          <input
                            ref={uploadInputRef}
                            type="file"
                            accept="image/*"
                            onChange={(e) => updateProfilePictureFromFile(e.target.files?.[0])}
                            className="profile-file-input"
                            aria-label="Upload profile picture file"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="profile-name">{profile.name}</p>
                        <p className="profile-bio">{profile.biography}</p>
                      </>
                    )}

                    <select
                      value={profile.status}
                      onChange={(e) => updateProfileField("status", e.target.value)}
                      aria-label="User availability status"
                    >
                      <option>Online</option>
                      <option>Away</option>
                      <option>Offline</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => setEditingProfile(!editingProfile)}
                      className="edit-profile-btn"
                    >
                      {editingProfile ? "Save Profile" : "Edit Profile"}
                    </button>
                  </div>
                </section>
              )}

              {currentScreen === "notifications" && (
                <section className="screen notifications-screen" aria-label="Notifications screen">
                  <div className="notifications-header">
                    <h2>Notifications</h2>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        className="clear-notifications-btn"
                        onClick={() => {
                          setNotifications([]);
                          localStorage.removeItem('nui-notifications');
                        }}
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="notifications-list">
                    {notifications.length === 0 ? (
                      <p className="empty-state">No notifications yet</p>
                    ) : (
                      <ul className="list">
                        {notifications.map((notice, idx) => {
                          const isFriendRequestIncoming = typeof notice === 'object' && notice.type === 'friend-request-incoming';
                          const isFriendRequestOutgoing = typeof notice === 'object' && notice.type === 'friend-request-outgoing';
                          const noticeType = typeof notice === 'object' ? notice.type : '';
                          const text = typeof notice === 'string' ? notice : notice.text;
                          const key = typeof notice === 'object' && notice.id ? notice.id : `notice-${idx}`;
                          const timestamp = typeof notice === 'object' && notice.timestamp ? notice.timestamp : null;
                          const timeString = timestamp ? new Date(timestamp).toLocaleString() : '';
                          
                          return (
                            <li key={key} className={`notification-item ${isFriendRequestIncoming ? 'friend-request' : ''} ${isFriendRequestOutgoing ? 'friend-request-sent' : ''} ${noticeType || ''}`}>
                              <div className="notification-content">
                                <span className="notification-text">{text}</span>
                                {timeString && (
                                  <span className="notification-time">{timeString}</span>
                                )}
                              </div>
                              {isFriendRequestIncoming && (
                                <div className="notification-actions">
                                  <button
                                    type="button"
                                    className="accept-btn"
                                    onClick={() => handleAcceptRequest(notice.requestId, notice.fromUsername)}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className="reject-btn"
                                    onClick={() => handleRejectRequest(notice.requestId, notice.fromUsername)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              {currentScreen === "home" && (
                <section className="screen home-screen" aria-label="Home screen">
                  {!showChat ? (
                    <div className="home-content">
                      {/* Friends Section */}
                      <div className="section-container">
                        <div className="section-header">
                          <h2>Your Friends</h2>
                          <div className="inline-input add-friend-inline">
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              onKeyPress={(e) => e.key === "Enter" && handleSearchUsers()}
                              placeholder="Search users..."
                              aria-label="Search users"
                            />
                            <button type="button" onClick={handleSearchUsers} disabled={isSearching}>
                              {isSearching ? "..." : "Search"}
                            </button>
                          </div>
                        </div>

                        {/* Search Results */}
                        {showSearchResults && searchResults.length > 0 && (
                          <div className="search-results">
                            <h4>Search Results</h4>
                            {searchResults.map((user) => (
                              <div key={user.uid} className="search-result-item">
                                <div className="user-info">
                                  <img
                                    src={user.photoURL || "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM="}
                                    alt={user.displayName}
                                  />
                                  <span>{user.displayName || user.email?.split("@")[0]}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSendFriendRequest(user.uid, user.displayName || user.email?.split("@")[0])}
                                >
                                  Add Friend
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="close-search-btn"
                              onClick={() => { setShowSearchResults(false); setSearchResults([]); }}
                            >
                              Close
                            </button>
                          </div>
                        )}

                        {/* Friend Requests */}
                        {friendRequests.length > 0 && (
                          <div className="friend-requests">
                            <h4>Friend Requests ({friendRequests.length})</h4>
                            {friendRequests.map((request) => (
                              <div key={request.id} className="friend-request-item">
                                <span>{request.fromUsername} wants to be friends</span>
                                <div className="request-actions">
                                  <button
                                    type="button"
                                    className="accept-btn"
                                    onClick={() => handleAcceptRequest(request.id, request.fromUsername)}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className="reject-btn"
                                    onClick={() => handleRejectRequest(request.id, request.fromUsername)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="profile-cards">
                          {friends.length === 0 ? (
                            <p className="empty-friends">No friends yet. Search for users above to add friends!</p>
                          ) : (
                            friends.map((friend) => {
                              const friendUid = friendStatus[friend]?.uid;
                              const conversationId = friendUid ? `private-${[currentUser.uid, friendUid].sort().join('-')}` : `private-${friend}`;
                              const unreadCount = unreadMessages[conversationId] || 0;
                              
                              return (
                              <div key={friend} className="friend-card-wrapper">
                                <button
                                  type="button"
                                  className="profile-card-btn"
                                  onClick={async () => {
                                    setSelectedFriend(friend);
                                    console.log("Friend UID:", friendUid);
                                    console.log("Current user UID:", currentUser?.uid);
                                    console.log("Conversation ID:", conversationId);
                                    setActiveConversationId(conversationId);
                                    setShowChat(true);
                                    
                                    // Reset unread count for this conversation
                                    resetUnreadCount(conversationId);
                                    
                                    // Add conversation to local state if it doesn't exist
                                    setConversations(prev => {
                                      console.log("Current conversations before adding:", prev.map(c => c.id));
                                      const exists = prev.find(c => c.id === conversationId);
                                      console.log("Conversation exists:", exists);
                                      if (!exists) {
                                        const newConvo = {
                                          id: conversationId,
                                          type: "private",
                                          title: `Private: ${friend}`,
                                          participants: ["You", friend],
                                          messages: [],
                                        };
                                        console.log("Adding new conversation:", newConvo);
                                        return [...prev, newConvo];
                                      }
                                      return prev;
                                    });
                                    
                                    // Create conversation in Firestore if it doesn't exist
                                    if (currentUser && friendUid) {
                                      try {
                                        await createConversation({
                                          id: conversationId,
                                          type: "private",
                                          title: `Private: ${friend}`,
                                          participants: [currentUser.uid, friendUid],
                                        });
                                      } catch (error) {
                                        console.log("Conversation may already exist:", error);
                                      }
                                    }
                                  }}
                                  aria-label={`Chat with ${friend}`}
                                >
                                  <div className="profile-card-image">
                                    <img
                                      src={friendStatus[friend]?.picture || "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM="}
                                      alt={friend}
                                    />
                                    <span className={`status-dot ${friendStatus[friend]?.online ? "online" : "offline"}`} />
                                  </div>
                                  <span className="profile-card-name">{friend}</span>
                                  {unreadCount > 0 && (
                                    <span className="message-badge">{unreadCount}</span>
                                  )}
                                </button>
                              </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Groups Section */}
                      <div className="section-container groups-section">
                        <div className="section-header">
                          <h2>Groups</h2>
                          <div className="inline-input add-friend-inline">
                            <input
                              type="text"
                              value={newGroupName}
                              onChange={(e) => setNewGroupName(e.target.value)}
                              placeholder="Create group chat"
                              aria-label="Create group chat"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (newGroupName.trim()) {
                                  setShowGroupMemberSelect(true);
                                } else {
                                  setStatus("Enter a group name first.");
                                }
                              }}
                            >
                              Create
                            </button>
                          </div>
                        </div>
                        <div className="groups-list">
                          {conversations.filter(c => c.type === "group").map((group) => (
                            <button
                              key={group.id}
                              type="button"
                              className="group-card-btn"
                              onClick={() => {
                                setSelectedFriend(null);
                                setActiveConversationId(group.id);
                                setShowChat(true);
                              }}
                              aria-label={`Open ${group.title}`}
                            >
                              <div className="group-icon">
                                <span>{group.title.charAt(group.title.indexOf(":") + 2).toUpperCase()}</span>
                              </div>
                              <span className="group-card-name">{group.title.replace("Group: ", "")}</span>
                              <span className="group-participants">{group.participants.length} members</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="direct-chat-view">
                      <div className="direct-chat-header">
                        <button
                          type="button"
                          className="back-btn"
                          onClick={() => {
                            setShowChat(false);
                            setSelectedFriend(null);
                          }}
                        >
                          ← Back
                        </button>
                        <div className="chat-header-info">
                          {selectedFriend ? (
                            <>
                              <img
                                className="chat-header-avatar"
                                src={friendStatus[selectedFriend]?.picture || "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM="}
                                alt={selectedFriend}
                              />
                              <span className="chat-header-name">{selectedFriend}</span>
                              <span className={`status-dot small ${friendStatus[selectedFriend]?.online ? "online" : "offline"}`} />
                            </>
                          ) : (
                            <>
                              <div className="group-avatar">{activeConversation?.title?.charAt(activeConversation?.title?.indexOf(":") + 2) || "G"}</div>
                              <span className="chat-header-name">{activeConversation?.title?.replace("Group: ", "") || "Group"}</span>
                            </>
                          )}
                        </div>
                        {selectedFriend ? (
                          <button
                            type="button"
                            className="unfriend-header-btn"
                            onClick={() => {
                              if (window.confirm(`Remove ${selectedFriend} from your friends?`)) {
                                handleUnfriend(selectedFriend);
                                setShowChat(false);
                                setSelectedFriend(null);
                              }
                            }}
                          >
                            Unfriend
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="leave-group-btn"
                            onClick={() => leaveGroupChat(activeConversationId)}
                          >
                            Leave Group
                          </button>
                        )}
                      </div>

                      <div className="direct-chat-messages">
                        {(activeConversation?.messages ?? []).length === 0 ? (
                          <div className="empty-chat">No messages yet. Start the conversation!</div>
                        ) : (
                          <ul className="direct-messages-list">
                            {(activeConversation?.messages ?? []).map((message) => (
                              <li key={message.id} className={`direct-message ${message.sender === "You" ? "own" : ""}`}>
                                <div className="message-bubble">
                                  <span className="message-sender">{message.sender}</span>
                                  <span className="message-text">{message.text}</span>
                                  <span className="message-time">{message.time}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="direct-chat-input">
                        <div className="chat-input-row">
                          <input
                            type="text"
                            value={chatMessage}
                            onChange={(e) => setChatMessage(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === "Enter" && chatMessage.trim()) {
                                sendMessage();
                              }
                            }}
                            placeholder="Type a message"
                            aria-label="Type a message"
                          />
                          <button type="button" className="send-button" onClick={() => chatMessage.trim() && sendMessage()}>Send</button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </main>

            {/* Footer Navigation */}
            <footer className="app-footer">
              <button
                type="button"
                className={`nav-btn${currentScreen === "profile" ? " active" : ""}`}
                onClick={() => setCurrentScreen("profile")}
              >
                User Profile
              </button>
              <button
                type="button"
                className={`nav-btn${currentScreen === "home" ? " active" : ""}`}
                onClick={() => setCurrentScreen("home")}
              >
                Home
              </button>
              <button
                type="button"
                className={`nav-btn${currentScreen === "notifications" ? " active" : ""}`}
                onClick={() => setCurrentScreen("notifications")}
              >
                Notifications
                {unreadCount > 0 && (
                  <span className="notification-badge">{unreadCount}</span>
                )}
              </button>
            </footer>

            <p className="status">{status}</p>
            <p className="meta">
              {handsSeen > 0 ? `${handsSeen} hand${handsSeen > 1 ? "s" : ""} tracked` : "Waiting for hands"}
              {isListening ? " | SPEECH..." : ""}
              {isClicking ? " | CLICK!" : ""}
            </p>
          </section>

        {showCameraCapture && (
          <div className="camera-modal-overlay" onClick={cancelCameraCapture}>
            <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Take Profile Picture</h3>
              <video ref={profileVideoRef} autoPlay playsInline className="camera-video" />
              <canvas ref={profileCanvasRef} style={{ display: "none" }} />
              <div className="camera-actions">
                <button type="button" onClick={captureProfilePicture}>Capture</button>
                <button type="button" onClick={cancelCameraCapture}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showGroupMemberSelect && (
          <div className="camera-modal-overlay" onClick={() => setShowGroupMemberSelect(false)}>
            <div className="camera-modal member-select-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Select Members for "{newGroupName}"</h3>
              <div className="member-select-list">
                {friends.length === 0 ? (
                  <p className="empty-members">No friends to add. Add friends first!</p>
                ) : (
                  friends.map((friend) => (
                    <label key={friend} className="member-select-item">
                      <input
                        type="checkbox"
                        checked={selectedGroupMembers.includes(friend)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroupMembers((prev) => [...prev, friend]);
                          } else {
                            setSelectedGroupMembers((prev) => prev.filter((f) => f !== friend));
                          }
                        }}
                      />
                      <img
                        src={friendStatus[friend]?.picture || "https://media.istockphoto.com/id/512830984/photo/icon-man-on-a-white-background-3d-render.webp?b=1&s=612x612&w=0&k=20&c=XApNjZNyiu4Oc-xGxtRLOsxIvtsZtL3jZRTOxv4G-NM="}
                        alt={friend}
                      />
                      <span>{friend}</span>
                    </label>
                  ))
                )}
              </div>
              <div className="member-select-actions">
                <button
                  type="button"
                  className="create-group-btn"
                  onClick={createGroupChat}
                  disabled={selectedGroupMembers.length === 0}
                >
                  Create Group ({selectedGroupMembers.length} selected)
                </button>
                <button type="button" onClick={() => setShowGroupMemberSelect(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
        </>
      ) : showSignUp ? (
        <section className="login-card">
          <h1 className="brand">
            Ny<span>o</span>UI
          </h1>

          {verificationSent ? (
            <div className="verification-message">
              <h3>Verify Your Email</h3>
              <p>We've sent a verification email to <strong>{signUpEmail}</strong>.</p>
              <p>Please check your inbox and click the verification link to activate your account.</p>
              <div className="actions">
                <button type="button" onClick={resetSignUp}>Back to Login</button>
              </div>
            </div>
          ) : (
            <>
              <form
                className="fields"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSignUp();
                }}
              >
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    placeholder="Enter your email"
                    aria-label="Email"
                  />
                </label>

                <label className="field">
                  <span>Username</span>
                  <input
                    type="text"
                    value={signUpUsername}
                    onChange={(e) => setSignUpUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, MAX_FIELD_LENGTH))}
                    placeholder="Choose a username"
                    aria-label="Username"
                  />
                </label>

                <label className="field password-field">
                  <span>Password</span>
                  <div className="password-input-wrapper">
                    <input
                      type={showSignUpPassword ? "text" : "password"}
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                      placeholder="Create a password"
                      aria-label="Password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      aria-label={showSignUpPassword ? "Hide password" : "Show password"}
                    >
                      {showSignUpPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </label>

                <label className="field password-field">
                  <span>Confirm Password</span>
                  <div className="password-input-wrapper">
                    <input
                      type={showSignUpConfirmPassword ? "text" : "password"}
                      value={signUpConfirmPassword}
                      onChange={(e) => setSignUpConfirmPassword(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                      placeholder="Re-enter your password"
                      aria-label="Confirm Password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowSignUpConfirmPassword(!showSignUpConfirmPassword)}
                      aria-label={showSignUpConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showSignUpConfirmPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </label>
              </form>

              <div className="actions">
                <button type="button" onClick={resetSignUp}>Back to Login</button>
                <button type="button" onClick={handleSignUp}>Create Account</button>
              </div>
            </>
          )}

          <p className="status">{status}</p>
          <p className="meta">
            {handsSeen > 0 ? `${handsSeen} hand${handsSeen > 1 ? "s" : ""} tracked` : "Waiting for hands"}
            {isListening ? " | SPEECH..." : ""}
            {isClicking ? " | CLICK!" : ""}
          </p>
        </section>
      ) : (
        <section className="login-card">
          <h1 className="brand">
            Ny<span>o</span>UI
          </h1>

          <form
            className="fields"
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <label className={activeField === "username" ? "field active" : "field"}>
              <span>Email / Username</span>
              <input
                ref={userRef}
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  usernameRef.current = e.target.value;
                }}
                onClick={() => { setActiveField("username"); setPendingField(null); setStatus("Email or username active. Click, index up to speak, two palms to delete, or two thumbs up to login."); }}
                placeholder="EMAIL OR USERNAME"
              />
            </label>

            <label className={activeField === "password" ? "field active" : "field"}>
              <span>Password</span>
              <input
                ref={passRef}
                type="password"
                value={password}
                onChange={(e) => {
                  const next = e.target.value.slice(0, MAX_FIELD_LENGTH);
                  setPassword(next);
                  passwordRef.current = next;
                }}
                onClick={() => { setActiveField("password"); setPendingField(null); setStatus("Password active. Click, index up to speak, two palms to delete, or two thumbs up to login."); }}
                placeholder="SPEECH OR TYPE PASSWORD"
              />
            </label>
          </form>

          <div className="actions">
            <button type="button" onClick={() => setShowGuide(true)}>CONTROLS</button>
            <button type="button" onClick={() => setShowSignUp(true)}>SIGN UP</button>
            <button type="button" onClick={handleLogin}>LOGIN</button>
          </div>

          <p className="status">{status}</p>
          <p className="meta">
            {handsSeen > 0 ? `${handsSeen} hand${handsSeen > 1 ? "s" : ""} tracked` : "Waiting for hands"} |{" "}
            {pendingField ? `pending: ${pendingField}` : `active: ${activeField ?? "none"}`}
            {isListening ? " | SPEECH..." : ""}
            {isClicking ? " | CLICK!" : ""}
          </p>
        </section>
      )}

      <div className={`camera-pane${showCamera ? "" : " camera-pane--hidden"}`} aria-label="Gesture camera">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={canvasRef} />
        <button className="camera-toggle" onClick={() => setShowCamera(!showCamera)} aria-label={showCamera ? "Hide camera" : "Show camera"}>
          {showCamera ? "✕" : "self camera"}
        </button>
      </div>

      <div
        className={`cursor-follower${isClicking ? " clicking" : ""}${isListening ? " listening" : ""}`}
        style={{
          left: `${cursorPos.x}%`,
          top: `${cursorPos.y}%`,
          opacity: handsSeen > 0 ? 0.85 : 0,
        }}
      />

      {showGuide && (
        <div className="guide-overlay" onClick={() => setShowGuide(false)}>
          <div className="guide-modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <button className="guide-close" onClick={() => setShowGuide(false)}>✕</button>
            <h2>Settings</h2>
            
            {/* Sound Settings */}
            <div className="settings-section">
              <h3>Sound & Audio</h3>
              <div className="settings-item">
                <div className="settings-info">
                  <span className="settings-label">Notification Sounds</span>
                  <span className="settings-description">Play sound for new messages and notifications</span>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${soundEnabled ? 'enabled' : 'disabled'}`}
                  onClick={() => setSoundEnabled(!soundEnabled)}
                >
                  {soundEnabled ? '🔔 On' : '🔕 Off'}
                </button>
              </div>
              
              <div className="settings-item">
                <div className="settings-info">
                  <span className="settings-label">Text-to-Speech</span>
                  <span className="settings-description">Speak elements on hover/focus</span>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${ttsEnabled ? 'enabled' : 'disabled'}`}
                  onClick={() => setTtsEnabled(!ttsEnabled)}
                >
                  {ttsEnabled ? '🔊 On' : '🔇 Off'}
                </button>
              </div>
            </div>
            
            {/* Controls Guide */}
            <div className="settings-section">
              <h3>Gesture Controls Guide</h3>
              <div className="guide-content">
                <div className="guide-item">
                  <strong>Move cursor:</strong> Point index finger anywhere
                </div>
                <div className="guide-item">
                  <strong>Click:</strong> Thumbs up with other hand while pointing
                </div>
                <div className="guide-item">
                  <strong>Speech-to-text:</strong> Index finger pointing directly up (vertical) when field is active
                </div>
                <div className="guide-item">
                  <strong>Delete last char:</strong> Two hands, both open palms facing camera
                </div>
                <div className="guide-item">
                  <strong>Login:</strong> Two thumbs up
                </div>
                <div className="guide-item">
                  <strong>Select username field:</strong> Show open palm, then nod
                </div>
                <div className="guide-item">
                  <strong>Select password field:</strong> Show back of hand, then nod
                </div>
                <div className="guide-item">
                  <strong>Click input directly:</strong> Point at input with cursor and thumbs up
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
