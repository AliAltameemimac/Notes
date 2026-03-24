import React, { useState, useEffect, useMemo } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  Plus, 
  LogOut, 
  Search, 
  Filter, 
  MoreVertical, 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle,
  Trash2,
  Edit2,
  X,
  ChevronDown,
  LayoutGrid,
  List as ListIcon,
  User as UserIcon,
  MessageSquare,
  Send,
  Paperclip,
  FileText,
  Download,
  Loader2,
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { auth, db } from './firebase';
import { cn } from './lib/utils';
import { 
  Task, 
  TaskStatus, 
  TaskPriority, 
  UserProfile, 
  Comment,
  OperationType, 
  FirestoreErrorInfo 
} from './types';

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const PriorityBadge = ({ priority }: { priority: TaskPriority }) => {
  const styles = {
    low: "bg-blue-50 text-blue-600 border-blue-100 shadow-sm shadow-blue-500/5",
    medium: "bg-amber-50 text-amber-600 border-amber-100 shadow-sm shadow-amber-500/5",
    high: "bg-rose-50 text-rose-600 border-rose-100 shadow-sm shadow-rose-500/5",
  };
  return (
    <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border", styles[priority])}>
      {priority}
    </span>
  );
};

const StatusIcon = ({ status }: { status: TaskStatus }) => {
  switch (status) {
    case 'todo': return (
      <div className="w-6 h-6 rounded-lg border-2 border-slate-200 flex items-center justify-center bg-white shadow-sm">
        <Circle className="w-3.5 h-3.5 text-slate-300" />
      </div>
    );
    case 'in-progress': return (
      <div className="w-6 h-6 rounded-lg border-2 border-amber-100 flex items-center justify-center bg-amber-50 shadow-sm shadow-amber-500/10">
        <Clock className="w-3.5 h-3.5 text-amber-500" />
      </div>
    );
    case 'done': return (
      <div className="w-6 h-6 rounded-lg border-2 border-emerald-100 flex items-center justify-center bg-emerald-50 shadow-sm shadow-emerald-500/10">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
      </div>
    );
  }
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority' | 'status'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [triggeredReminders, setTriggeredReminders] = useState<Set<string>>(new Set());

  // Notification Permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Reminder Check Logic
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      tasks.forEach(task => {
        if (task.status === 'done' || !task.dueDate || !task.reminderMinutesBefore) return;
        
        const dueTime = task.dueDate.toMillis();
        const reminderTime = dueTime - (task.reminderMinutesBefore * 60 * 1000);
        const reminderKey = `${task.id}-${task.reminderMinutesBefore}`;

        if (now >= reminderTime && now < dueTime && !triggeredReminders.has(reminderKey)) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Task Reminder: ${task.title}`, {
              body: `Your task is due in ${task.reminderMinutesBefore} minutes!`,
              icon: '/favicon.ico'
            });
            setTriggeredReminders(prev => new Set(prev).add(reminderKey));
          }
        }
      });
    };

    const interval = setInterval(checkReminders, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [tasks, triggeredReminders]);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Comments Listener
  useEffect(() => {
    if (!selectedTask) {
      setComments([]);
      return;
    }

    const q = query(
      collection(db, 'tasks', selectedTask.id, 'comments'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const commentsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Comment[];
      setComments(commentsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `tasks/${selectedTask.id}/comments`);
    });

    return () => unsubscribe();
  }, [selectedTask]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedTask || !newComment.trim()) return;

    setIsSubmittingComment(true);
    try {
      await addDoc(collection(db, 'tasks', selectedTask.id, 'comments'), {
        text: newComment.trim(),
        authorId: user.uid,
        authorName: user.displayName || 'Anonymous',
        authorPhoto: user.photoURL || undefined,
        createdAt: serverTimestamp(),
      });
      setNewComment('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `tasks/${selectedTask.id}/comments`);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTask || !user) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File size exceeds 10MB limit.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      
      const newAttachment = {
        id: Math.random().toString(36).substr(2, 9),
        name: data.name,
        url: data.url,
        size: data.size,
        type: data.type,
        createdAt: new Date().toISOString(), // Using ISO string for simplicity in client-side update
      };

      const updatedAttachments = [...(selectedTask.attachments || []), newAttachment];
      
      await updateDoc(doc(db, 'tasks', selectedTask.id), {
        attachments: updatedAttachments,
        updatedAt: serverTimestamp(),
      });

      setSelectedTask(prev => prev ? { ...prev, attachments: updatedAttachments } : null);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload file.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch or create profile
        const userDocRef = doc(db, 'users', currentUser.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || 'Anonymous',
              email: currentUser.email || '',
              photoURL: currentUser.photoURL || undefined,
              role: 'user',
              createdAt: serverTimestamp(),
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          } else {
            setProfile(userDoc.data() as UserProfile);
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
        }
      } else {
        setProfile(null);
        setTasks([]);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Tasks Listener
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'tasks'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(taskList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });

    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const filteredTasks = useMemo(() => {
    const priorityMap: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };
    const statusMap: Record<TaskStatus, number> = { todo: 1, 'in-progress': 2, done: 3 };

    return tasks
      .filter(task => {
        const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            task.description?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = filterStatus === 'all' || task.status === filterStatus;
        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'createdAt') {
          const timeA = a.createdAt?.toMillis?.() || 0;
          const timeB = b.createdAt?.toMillis?.() || 0;
          comparison = timeA - timeB;
        } else if (sortBy === 'priority') {
          comparison = priorityMap[a.priority] - priorityMap[b.priority];
        } else if (sortBy === 'status') {
          comparison = statusMap[a.status] - statusMap[b.status];
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [tasks, searchQuery, filterStatus, sortBy, sortOrder]);

  const handleSaveTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;

    const formData = new FormData(e.currentTarget);
    const dateValue = formData.get('dueDate') as string;
    const timeValue = formData.get('dueTime') as string;
    
    let dueDate: Timestamp | null = null;
    if (dateValue) {
      const dateTimeStr = timeValue ? `${dateValue}T${timeValue}` : `${dateValue}T00:00`;
      dueDate = Timestamp.fromDate(new Date(dateTimeStr));
    }

    const taskData = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      status: formData.get('status') as TaskStatus,
      priority: formData.get('priority') as TaskPriority,
      ownerId: user.uid,
      dueDate,
      reminderMinutesBefore: parseInt(formData.get('reminderMinutesBefore') as string) || 0,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingTask) {
        await updateDoc(doc(db, 'tasks', editingTask.id), taskData);
      } else {
        await addDoc(collection(db, 'tasks'), {
          ...taskData,
          createdAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
      setEditingTask(null);
    } catch (error) {
      handleFirestoreError(error, editingTask ? OperationType.UPDATE : OperationType.CREATE, 'tasks');
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', id));
      setTaskToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${id}`);
    }
  };

  const toggleTaskStatus = async (task: Task) => {
    const nextStatus: Record<TaskStatus, TaskStatus> = {
      'todo': 'in-progress',
      'in-progress': 'done',
      'done': 'todo'
    };
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        status: nextStatus[task.status],
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Background Decorative Elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 rounded-full blur-3xl" />
        
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white/80 backdrop-blur-xl p-10 rounded-[3rem] shadow-2xl shadow-brand-500/10 text-center border border-white relative z-10"
        >
          <div className="w-20 h-20 bg-brand-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-brand-500/30">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-display font-bold text-slate-950 mb-3 tracking-tight">TaskFlow</h1>
          <p className="text-slate-500 mb-10 leading-relaxed">Streamline your productivity with real-time task management and elegant design.</p>
          <button
            onClick={handleLogin}
            className="w-full py-4 px-6 bg-slate-950 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-950/20"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Continue with Google
          </button>
          <div className="mt-8 pt-8 border-t border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Powered by Firebase & Google AI</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-slate-200/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 bg-brand-500 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/20">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight hidden sm:block text-slate-950">TaskFlow</span>
          </div>

          <div className="flex-1 max-w-md">
            <div className="flex items-center bg-slate-100/50 rounded-2xl px-4 py-2 border border-slate-200/50 focus-within:bg-white focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-500/5 transition-all">
              <Search className="w-4 h-4 text-slate-400 mr-2" />
              <input 
                type="text" 
                placeholder="Search tasks..." 
                className="bg-transparent border-none focus:ring-0 text-sm w-full placeholder:text-slate-400"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-bold text-slate-950 truncate max-w-[120px]">{user.displayName}</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Free Plan</span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 shadow-sm">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-full h-full p-2 text-slate-500" />
              )}
            </div>
            <button 
              onClick={handleLogout}
              className="p-2.5 hover:bg-slate-100 rounded-2xl text-slate-400 hover:text-rose-500 transition-all active:scale-90"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
          <div>
            <h2 className="text-3xl font-display font-bold text-slate-950 tracking-tight">My Tasks</h2>
            <p className="text-slate-500 text-sm mt-1">You have {filteredTasks.length} tasks matching your filters.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-white rounded-2xl p-1 border border-slate-200 shadow-sm">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn("p-2 rounded-xl transition-all", viewMode === 'grid' ? "bg-brand-50 text-brand-600 shadow-sm" : "text-slate-400 hover:text-slate-600")}
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn("p-2 rounded-xl transition-all", viewMode === 'list' ? "bg-brand-50 text-brand-600 shadow-sm" : "text-slate-400 hover:text-slate-600")}
              >
                <ListIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 bg-white rounded-2xl p-1 border border-slate-200 shadow-sm">
              <select 
                className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer pr-8 pl-3 text-slate-700"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="createdAt">Date Created</option>
                <option value="priority">Priority</option>
                <option value="status">Status</option>
              </select>
              <button 
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-2 hover:bg-slate-50 rounded-xl text-slate-500 transition-all"
                title={sortOrder === 'asc' ? "Sort Ascending" : "Sort Descending"}
              >
                {sortOrder === 'asc' ? (
                  <motion.div initial={{ rotate: 0 }} animate={{ rotate: 180 }}><ChevronDown className="w-4 h-4" /></motion.div>
                ) : (
                  <motion.div initial={{ rotate: 180 }} animate={{ rotate: 0 }}><ChevronDown className="w-4 h-4" /></motion.div>
                )}
              </button>
            </div>

            <select 
              className="bg-white border-slate-200 rounded-2xl text-sm font-medium focus:ring-brand-500 focus:border-brand-500 shadow-sm px-4 py-2 text-slate-700"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
            >
              <option value="all">All Status</option>
              <option value="todo">To Do</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Done</option>
            </select>

            <button 
              onClick={() => { setEditingTask(null); setIsModalOpen(true); }}
              className="bg-brand-500 text-white px-6 py-2.5 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand-600 transition-all shadow-lg shadow-brand-500/25 active:scale-95"
            >
              <Plus className="w-5 h-5" />
              <span>Add Task</span>
            </button>
          </div>
        </div>

        {/* Task Grid/List */}
        {filteredTasks.length === 0 ? (
          <div className="bg-white/50 backdrop-blur-sm border-2 border-dashed border-slate-200 rounded-[2.5rem] p-16 text-center shadow-sm">
            <div className="w-20 h-20 bg-brand-50 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
              <Filter className="w-10 h-10 text-brand-300" />
            </div>
            <h3 className="text-2xl font-display font-bold text-slate-900 mb-2">No tasks found</h3>
            <p className="text-slate-500 max-w-xs mx-auto leading-relaxed">Try adjusting your search or filters, or create a new task to get started.</p>
          </div>
        ) : (
          <div className={cn(
            "grid gap-4",
            viewMode === 'grid' ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
          )}>
            <AnimatePresence mode="popLayout">
              {filteredTasks.map((task) => (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={cn(
                    "bg-white rounded-3xl border border-slate-200/60 p-6 card-hover group relative flex flex-col",
                    task.status === 'done' && "opacity-80 grayscale-[0.2]",
                    task.status !== 'done' && task.dueDate && task.dueDate.toMillis() < Date.now() && "border-rose-200 bg-rose-50/20"
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <button 
                      onClick={() => toggleTaskStatus(task)}
                      className="transition-transform active:scale-90 hover:scale-110"
                    >
                      <StatusIcon status={task.status} />
                    </button>
                    <div className="flex items-center gap-2">
                      {task.status !== 'done' && task.dueDate && task.dueDate.toMillis() < Date.now() && (
                        <motion.span 
                          animate={{ scale: [1, 1.05, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                        >
                          Overdue
                        </motion.span>
                      )}
                      <PriorityBadge priority={task.priority} />
                      <div className="opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1.5 bg-white/90 backdrop-blur-sm p-1 rounded-xl border border-slate-200 shadow-xl">
                        <button 
                          onClick={() => { setEditingTask(task); setIsModalOpen(true); }}
                          className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-brand-600 transition-colors"
                          title="Edit Task"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setSelectedTask(task)}
                          className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-brand-600 transition-colors"
                          title="View Comments"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setTaskToDelete(task.id)}
                          className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-rose-600 transition-colors"
                          title="Delete Task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <h4 className={cn(
                    "font-display font-bold text-xl mb-2 leading-tight text-slate-900",
                    task.status === 'done' && "line-through text-slate-400"
                  )}>
                    {task.title}
                  </h4>
                  {task.description && (
                    <p className="text-slate-500 text-sm line-clamp-2 mb-6 leading-relaxed">
                      {task.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-auto pt-5 border-t border-slate-100/80">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        <Plus className="w-3 h-3 mr-1.5" />
                        {task.createdAt instanceof Timestamp ? format(task.createdAt.toDate(), 'MMM d, h:mm a') : 'Just now'}
                      </div>
                      {task.dueDate && (
                        <div className={cn(
                          "flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg w-fit",
                          task.status === 'done' ? "bg-slate-50 text-slate-400" : 
                          task.dueDate.toMillis() < Date.now() ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600"
                        )}>
                          <Clock className="w-3 h-3 mr-1.5" />
                          <span>{format(task.dueDate.toDate(), 'MMM d')}</span>
                          <span className="mx-1.5 opacity-30">•</span>
                          <span>{format(task.dueDate.toDate(), 'h:mm a')}</span>
                          {task.reminderMinutesBefore && task.reminderMinutesBefore > 0 && (
                            <Bell className="w-3 h-3 ml-2 text-brand-400 animate-pulse" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
            >
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                <h3 className="text-2xl font-display font-bold text-slate-900">{editingTask ? 'Edit Task' : 'New Task'}</h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2.5 hover:bg-slate-200/50 rounded-2xl transition-colors text-slate-400 hover:text-slate-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSaveTask} className="p-8 space-y-6">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 ml-1">Title</label>
                  <input 
                    name="title"
                    required
                    defaultValue={editingTask?.title}
                    placeholder="What needs to be done?"
                    className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 ml-1">Description (Optional)</label>
                  <textarea 
                    name="description"
                    defaultValue={editingTask?.description}
                    placeholder="Add more details..."
                    rows={3}
                    className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all resize-none text-slate-900 placeholder:text-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 ml-1">Due Date & Time (Optional)</label>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input 
                        type="date"
                        name="dueDate"
                        id="dueDateInput"
                        defaultValue={editingTask?.dueDate ? format(editingTask.dueDate.toDate(), "yyyy-MM-dd") : ''}
                        className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all text-sm text-slate-700"
                      />
                      <input 
                        type="time"
                        name="dueTime"
                        id="dueTimeInput"
                        defaultValue={editingTask?.dueDate ? format(editingTask.dueDate.toDate(), "HH:mm") : ''}
                        className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all text-sm text-slate-700"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Today', getDate: () => format(new Date(), "yyyy-MM-dd"), getTime: () => "17:00" },
                        { label: 'Tomorrow', getDate: () => {
                          const d = new Date();
                          d.setDate(d.getDate() + 1);
                          return format(d, "yyyy-MM-dd");
                        }, getTime: () => "09:00" },
                        { label: 'Next Week', getDate: () => {
                          const d = new Date();
                          d.setDate(d.getDate() + 7);
                          return format(d, "yyyy-MM-dd");
                        }, getTime: () => "09:00" },
                      ].map(btn => (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => {
                            const dateInput = document.getElementById('dueDateInput') as HTMLInputElement;
                            const timeInput = document.getElementById('dueTimeInput') as HTMLInputElement;
                            if (dateInput) dateInput.value = btn.getDate();
                            if (timeInput) timeInput.value = btn.getTime();
                          }}
                          className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95"
                        >
                          {btn.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const dateInput = document.getElementById('dueDateInput') as HTMLInputElement;
                          const timeInput = document.getElementById('dueTimeInput') as HTMLInputElement;
                          if (dateInput) dateInput.value = '';
                          if (timeInput) timeInput.value = '';
                        }}
                        className="px-4 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 ml-1">Priority</label>
                    <select 
                      name="priority"
                      defaultValue={editingTask?.priority || 'medium'}
                      className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all text-slate-700 font-medium"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 ml-1">Status</label>
                    <select 
                      name="status"
                      defaultValue={editingTask?.status || 'todo'}
                      className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all text-slate-700 font-medium"
                    >
                      <option value="todo">To Do</option>
                      <option value="in-progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 ml-1">Reminder (Optional)</label>
                  <select 
                    name="reminderMinutesBefore"
                    defaultValue={editingTask?.reminderMinutesBefore || 0}
                    className="w-full bg-slate-50 border-slate-200 rounded-2xl px-4 py-3 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all text-sm text-slate-700 font-medium"
                  >
                    <option value={0}>No Reminder</option>
                    <option value={5}>5 minutes before</option>
                    <option value={15}>15 minutes before</option>
                    <option value={30}>30 minutes before</option>
                    <option value={60}>1 hour before</option>
                    <option value={1440}>1 day before</option>
                  </select>
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95"
                  >
                    {editingTask ? 'Update Task' : 'Create Task'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {taskToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setTaskToDelete(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8 text-center border border-slate-100"
            >
              <div className="w-20 h-20 bg-rose-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner shadow-rose-500/5">
                <Trash2 className="w-10 h-10 text-rose-500" />
              </div>
              <h3 className="text-2xl font-display font-bold text-slate-950 mb-3 tracking-tight">Delete Task?</h3>
              <p className="text-slate-500 mb-8 leading-relaxed">This action cannot be undone. Are you sure you want to remove this task from your flow?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setTaskToDelete(null)}
                  className="flex-1 py-4 bg-slate-50 text-slate-600 rounded-2xl font-bold hover:bg-slate-100 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDeleteTask(taskToDelete)}
                  className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/20 active:scale-95"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Task Details & Comments Modal */}
      <AnimatePresence>
        {selectedTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTask(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-100"
            >
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/30 backdrop-blur-md">
                <div className="flex items-center gap-4">
                  <StatusIcon status={selectedTask.status} />
                  <h3 className="text-2xl font-display font-bold text-slate-950 truncate max-w-[300px] tracking-tight">{selectedTask.title}</h3>
                </div>
                <button 
                  onClick={() => setSelectedTask(null)}
                  className="p-2.5 hover:bg-slate-200/50 rounded-2xl transition-all active:scale-90"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Task Info */}
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <PriorityBadge priority={selectedTask.priority} />
                    {selectedTask.dueDate && (
                      <div className={cn(
                        "px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center gap-2.5 shadow-sm",
                        selectedTask.status === 'done' ? "bg-slate-100 text-slate-500" :
                        selectedTask.dueDate.toMillis() < Date.now() ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-brand-50 text-brand-600 border border-brand-100"
                      )}>
                        <Clock className="w-4 h-4" />
                        <div className="flex items-center gap-2">
                          <span>{format(selectedTask.dueDate.toDate(), 'PPP')}</span>
                          <span className="opacity-30">•</span>
                          <span>{format(selectedTask.dueDate.toDate(), 'p')}</span>
                        </div>
                      </div>
                    )}
                    {selectedTask.reminderMinutesBefore && selectedTask.reminderMinutesBefore > 0 && (
                      <div className="px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center gap-2.5 bg-amber-50 text-amber-600 border border-amber-100 shadow-sm">
                        <Bell className="w-4 h-4" />
                        <span>Reminder: {selectedTask.reminderMinutesBefore >= 60 ? `${selectedTask.reminderMinutesBefore / 60}h` : `${selectedTask.reminderMinutesBefore}m`} before</span>
                      </div>
                    )}
                  </div>
                  {selectedTask.description && (
                    <div className="bg-slate-50/50 rounded-[2rem] p-6 text-slate-600 text-sm leading-relaxed border border-slate-100/50">
                      {selectedTask.description}
                    </div>
                  )}
                </div>

                {/* Attachments Section */}
                <div className="pt-8 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2.5">
                      <Paperclip className="w-4 h-4" />
                      Attachments ({selectedTask.attachments?.length || 0})
                    </h4>
                    <label className={cn(
                      "cursor-pointer px-4 py-2 bg-brand-500 text-white rounded-2xl text-xs font-bold hover:bg-brand-600 transition-all flex items-center gap-2 shadow-lg shadow-brand-500/20 active:scale-95",
                      isUploading && "opacity-50 cursor-not-allowed"
                    )}>
                      {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      {isUploading ? 'Uploading...' : 'Add File'}
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={handleFileUpload} 
                        disabled={isUploading}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {selectedTask.attachments?.map((file) => (
                      <div key={file.id} className="flex items-center gap-4 p-4 bg-white rounded-[1.5rem] border border-slate-100 group hover:border-brand-300 hover:shadow-xl hover:shadow-brand-500/5 transition-all">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100 text-slate-400 group-hover:text-brand-500 group-hover:bg-brand-50 transition-all">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-950 truncate">{file.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{formatFileSize(file.size)}</p>
                        </div>
                        <a 
                          href={file.url} 
                          download={file.name}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2.5 hover:bg-brand-50 rounded-xl text-slate-400 hover:text-brand-500 transition-all active:scale-90"
                        >
                          <Download className="w-5 h-5" />
                        </a>
                      </div>
                    ))}
                    {(!selectedTask.attachments || selectedTask.attachments.length === 0) && !isUploading && (
                      <div className="col-span-full text-center py-10 bg-slate-50/50 rounded-[2rem] border border-dashed border-slate-200">
                        <p className="text-slate-400 text-sm font-medium">No attachments yet.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Comments Section */}
                <div className="pt-8 border-t border-slate-100">
                  <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2.5">
                    <MessageSquare className="w-4 h-4" />
                    Comments ({comments.length})
                  </h4>

                  <div className="space-y-6 mb-8">
                    {comments.length === 0 ? (
                      <div className="text-center py-12 bg-slate-50/50 rounded-[2rem] border border-dashed border-slate-200">
                        <p className="text-slate-400 text-sm font-medium">No comments yet. Be the first to say something!</p>
                      </div>
                    ) : (
                      comments.map((comment) => (
                        <div key={comment.id} className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-2xl bg-brand-50 flex-shrink-0 flex items-center justify-center overflow-hidden border border-brand-100 shadow-sm">
                              {comment.authorPhoto ? (
                                <img 
                                  src={comment.authorPhoto} 
                                  alt={comment.authorName} 
                                  className="w-full h-full object-cover" 
                                  referrerPolicy="no-referrer" 
                                />
                              ) : (
                                <UserIcon className="w-4 h-4 text-brand-600" />
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-950">{comment.authorName}</span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {comment.createdAt instanceof Timestamp ? format(comment.createdAt.toDate(), 'MMM d, h:mm a') : 'Just now'}
                              </span>
                            </div>
                          </div>
                          <div className="bg-slate-50/80 rounded-[1.5rem] p-4 border border-slate-100 ml-11 shadow-sm">
                            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{comment.text}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment Form */}
                  <form onSubmit={handleAddComment} className="relative group">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      rows={2}
                      className="w-full bg-slate-50 border-slate-200 rounded-[1.5rem] px-5 py-4 pr-14 focus:ring-4 focus:ring-brand-500/5 focus:border-brand-500 focus:bg-white transition-all resize-none text-sm font-medium text-slate-700"
                      disabled={isSubmittingComment}
                    />
                    <button
                      type="submit"
                      disabled={!newComment.trim() || isSubmittingComment}
                      className="absolute right-3 bottom-3 p-3 bg-brand-500 text-white rounded-2xl hover:bg-brand-600 disabled:opacity-30 disabled:hover:bg-brand-500 transition-all active:scale-90 shadow-lg shadow-brand-500/20"
                    >
                      {isSubmittingComment ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Send className="w-5 h-5" />
                      )}
                    </button>
                  </form>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

