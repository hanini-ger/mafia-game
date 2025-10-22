import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, addDoc, serverTimestamp, runTransaction, updateDoc, where, getDocs, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
apiKey: "AIzaSyAICQgbjxiwmea-CPDUBGfCFveDfKqaD3s",
authDomain: "mafia-game-4b7be.firebaseapp.com",
projectId: "mafia-game-4b7be",
storageBucket: "mafia-game-4b7be.firebasestorage.app",
messagingSenderId: "867608731295",
appId: "1:867608731295:web:dd068f4f297121fa87ccaa",
measurementId: "G-DYDCMJ7GQC"
};

const appId = 'shadows-and-lies-live'; // This is a unique identifier...
const initialAuthToken = null; // Correct for Anonymous Auth
        
let db;
let auth;
let userId = '';
let lobbyCode = '';
let isHost = false;
let authTimeout;
let gameState = {
    players: [],
    config: {},
    currentPhase: 'LOBBY', // LOBBY, DAY, NIGHT, END
    dayNum: 0,
    log: [],
};
let myRole = { name: 'Villager', alignment: 'Town' };
let selectedTargetId = null; // For Night Action / Day Vote

// --- GAME CONSTANTS ---
const ALL_ROLES = {
    // Mafia Roles
    'Godfather': { alignment: 'Mafia', desc: 'Leads the nightly kill. Shows up as Town to Detective.' },
    'Mafioso': { alignment: 'Mafia', desc: 'Carries out the kill if the Godfather is unavailable.' },
    'Consigliere': { alignment: 'Mafia', desc: 'Investigates a target to learn their exact role.' },
    'Blackmailer': { alignment: 'Mafia', desc: 'Silences a player for the next Day phase.' },
    // Town Roles
    'Detective': { alignment: 'Town', desc: 'Investigates a target to learn their alignment.' },
    'Doctor': { alignment: 'Town', desc: 'Heals a target, protecting them from death.' },
    'Jailer': { alignment: 'Town', desc: 'Detains a target, preventing all actions/deaths for the night.' },
    'Bodyguard': { alignment: 'Town', desc: 'Guards a target. Dies with attacker if target is attacked.' },
    'Priest': { alignment: 'Town', desc: 'Learns the role of a dead player.' },
    'Mayor': { alignment: 'Town', desc: 'Has 2 votes during the Day trial.' },
    'Granny': { alignment: 'Town', desc: 'Shoots anyone who visits her once per game.' },
    'Tough Guy': { alignment: 'Town', desc: 'Has one layer of defense against a single attack.' },
    'Villager': { alignment: 'Town', desc: 'No night ability, must rely on deduction.' },
    // Neutral Roles
    'Creeper': { alignment: 'Neutral', desc: 'Role-blocks a player, preventing their night action.' },
};
const INITIAL_ROLE_CONFIG = {
    'Godfather': 1, 'Mafioso': 1, 'Consigliere': 0, 'Blackmailer': 0,
    'Detective': 1, 'Doctor': 1, 'Jailer': 0, 'Bodyguard': 0, 'Priest': 0,
    'Mayor': 0, 'Granny': 0, 'Tough Guy': 0, 'Villager': 2,
    'Creeper': 0,
};

// --- FIREBASE INITIALIZATION & AUTH ---
function initFirebase() {
    // Set a timeout to catch long connection times
    authTimeout = setTimeout(() => {
        const loadingScreen = document.getElementById('loading-screen');
        loadingScreen.innerHTML = `
            <p class="text-red-400 text-center p-4 glass-card">
                Connection timed out (5s). Please check your browser console for errors or try reloading.<br>
                This might indicate an issue with the Firebase configuration or network access.
            </p>
        `;
    }, 5000); // 15 seconds timeout

    try {
        // Check if config is available before initialization
        if (!firebaseConfig || !firebaseConfig.apiKey) {
            throw new Error("Firebase configuration is missing or incomplete.");
        }

        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        setLogLevel('Debug'); // Enable debug logging for Firestore

        onAuthStateChanged(auth, async (user) => {
            clearTimeout(authTimeout); // Clear timeout on successful authentication check
            
            if (user) {
                userId = user.uid;
                document.getElementById('my-player-id').textContent = `ID: ${userId}`;
                
                // Set the default alias
                const aliasInput = document.getElementById('player-alias-input');
                if (!aliasInput.value || aliasInput.value === 'Player Alias') {
                     aliasInput.value = `Anon${Math.floor(Math.random() * 1000)}`;
                     localStorage.setItem('mafiaAlias', aliasInput.value);
                }

                // Once authenticated, switch to landing screen
                window.switchScreen('landing-screen');
                
            } else {
                // User not authenticated yet, sign in
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    // If no custom token, sign in anonymously
                    await signInAnonymously(auth);
                }
            }
        });

    } catch (error) {
        clearTimeout(authTimeout);
        console.error("Firebase Initialization Error:", error);
        document.getElementById('loading-screen').innerHTML = `
            <p class="text-red-400 text-center p-4 glass-card">
                Error: Could not connect to Firebase.<br>Check console for details, specifically regarding the config or network access.
            </p>
        `;
    }
}

// --- LOBBY MANAGEMENT ---

function handleLobbyAction(action) {
    const alias = document.getElementById('player-alias-input').value.trim();
    if (!alias) {
        // Use a visual cue instead of alert
        document.getElementById('player-alias-input').classList.add('border-red-500');
        setTimeout(() => document.getElementById('player-alias-input').classList.remove('border-red-500'), 1500);
        return;
    }
    localStorage.setItem('mafiaAlias', alias);

    const code = document.getElementById('room-code-input').value.trim().toUpperCase();

    if (action === 'create') {
        createLobby(alias);
    } else if (action === 'join') {
        if (code) {
            joinLobby(code, alias);
        } else {
            // Use a visual cue instead of alert
            document.getElementById('room-code-input').classList.add('border-red-500');
            setTimeout(() => document.getElementById('room-code-input').classList.remove('border-red-500'), 1500);
        }
    }
}

async function createLobby(alias) {
    lobbyCode = generateRandomCode(6);
    isHost = true;
    const lobbyRef = doc(db, getLobbyPath(lobbyCode));

    try {
        await setDoc(lobbyRef, {
            hostId: userId,
            phase: 'LOBBY',
            dayNum: 0,
            log: [],
            config: INITIAL_ROLE_CONFIG,
            players: [{ id: userId, alias: alias, isHost: true, status: 'alive', vote: null }],
            chat: { public: [], mafia: [] },
            roles: {},
        }, { merge: true });

        console.log(`Lobby created: ${lobbyCode}`);
        listenToLobby(lobbyCode);
        window.switchScreen('lobby-screen');
    } catch (e) {
        console.error("Error creating lobby: ", e);
    }
}

async function joinLobby(code, alias) {
    lobbyCode = code;
    const lobbyRef = doc(db, getLobbyPath(lobbyCode));

    try {
        const lobbySnap = await getDoc(lobbyRef);
        if (!lobbySnap.exists()) {
            console.error("Lobby does not exist.");
             // Add temporary feedback to the user via UI
            document.getElementById('room-code-input').placeholder = "❌ Code Not Found";
            setTimeout(() => document.getElementById('room-code-input').placeholder = "Room Code (Optional, for Joining)", 2000);
            return;
        }

        const lobbyData = lobbySnap.data();
        isHost = lobbyData.hostId === userId;

        // Check if already in players array and update if necessary
        let playerExists = false;
        const updatedPlayers = lobbyData.players.map(p => {
            if (p.id === userId) {
                playerExists = true;
                return { ...p, alias: alias, isHost: p.id === lobbyData.hostId };
            }
            return p;
        });

        if (!playerExists) {
            updatedPlayers.push({ id: userId, alias: alias, isHost: false, status: 'alive', vote: null });
        }

        await updateDoc(lobbyRef, {
            players: updatedPlayers
        });
        
        listenToLobby(lobbyCode);
        window.switchScreen('lobby-screen');
    } catch (e) {
        console.error("Error joining lobby: ", e);
    }
}

// --- REAL-TIME LISTENERS ---
function listenToLobby(code) {
    const lobbyRef = doc(db, getLobbyPath(code));

    onSnapshot(lobbyRef, (docSnap) => {
        if (docSnap.exists()) {
            gameState = docSnap.data();
            
            // Update current user's role and info
            const myPlayer = gameState.players.find(p => p.id === userId);
            if (myPlayer && gameState.roles[userId]) {
                myRole = ALL_ROLES[gameState.roles[userId]];
            } else if (myPlayer) {
                // Default role if not yet assigned
                myRole = { name: 'Villager', alignment: 'Town' }; 
            }
            
            window.renderUI();

            // Check for phase change to trigger game screen switch
            if (gameState.phase !== 'LOBBY' && document.getElementById('game-screen').classList.contains('hidden')) {
                 window.switchScreen('game-screen');
            }

        } else {
            console.log("Lobby dissolved or left.");
            // Go back to landing if lobby disappears
            window.switchScreen('landing-screen');
        }
    });
}

// --- GAME LOGIC (HOST) ---
function startGame() {
    if (!isHost) return;

    // 1. Collect final role configuration
    const config = {};
    document.querySelectorAll('.role-input').forEach(input => {
        config[input.dataset.role] = parseInt(input.value);
    });
    
    // 2. Validate player count vs roles count
    const totalPlayers = gameState.players.length;
    const totalRoles = Object.values(config).reduce((a, b) => a + b, 0);

    if (totalRoles !== totalPlayers) {
        // Use a visual cue instead of alert
        document.getElementById('start-game-button').textContent = `ERROR: Roles (${totalRoles}) != Players (${totalPlayers})`;
        document.getElementById('start-game-button').classList.add('bg-red-700', 'border-red-500');
        setTimeout(() => {
            document.getElementById('start-game-button').textContent = 'START GAME';
            document.getElementById('start-game-button').classList.remove('bg-red-700', 'border-red-500');
        }, 3000);
        return;
    }

    // ... (lines inside startGame function)

    // 3. Assign Roles
    const rolesArray = [];
    for (const [role, count] of Object.entries(config)) {
        for (let i = 0; i < count; i++) {
            rolesArray.push(role);
        }
    }

    // --- START FIX ---
    // If there are fewer roles than players, fill the remaining slots with Villagers
    while (rolesArray.length < totalPlayers) {
        rolesArray.push('Villager');
    }
    // --- END FIX ---

    // Shuffle the array of roles
    window.shuffleArray(rolesArray);

    // 4. Update Game State
    const updates = {
    // ... (rest of the code to assign roles and start the game)

    const assignedRoles = {};
    gameState.players.forEach((player, index) => {
        assignedRoles[player.id] = rolesArray[index];
    });

    // 4. Update Game State
    const lobbyRef = doc(db, getLobbyPath(lobbyCode));
    updateDoc(lobbyRef, {
        phase: 'NIGHT',
        dayNum: 1,
        roles: assignedRoles,
        config: config, // Save final config
        log: [{ type: 'info', message: 'Game started. It is now Night 1.' }],
        chat: { public: [], mafia: [] }, // Reset chat logs
    });
}

async function submitNightAction() {
    if (!selectedTargetId || gameState.phase !== 'NIGHT') return;

    const actionData = {
        performerId: userId,
        performerRole: myRole.name,
        targetId: selectedTargetId,
        timestamp: serverTimestamp(),
    };

    // Use runTransaction to ensure we don't overwrite another action if concurrent submissions happen
     try {
        await runTransaction(db, async (transaction) => {
            const actionRef = doc(db, window.getActionPath(lobbyCode, gameState.dayNum, userId));
            transaction.set(actionRef, actionData);
        });
        document.getElementById('submit-night-action-btn').textContent = `Action Submitted for ${gameState.players.find(p => p.id === selectedTargetId).alias}`;
        document.getElementById('submit-night-action-btn').disabled = true;
    } catch (e) {
        console.error("Error submitting night action: ", e);
    }
}

async function tallyVotes() {
    if (!isHost || gameState.phase !== 'DAY' || gameState.dayNum === 0) return;
    // Simplified: In a real game, this would involve complex vote counting and logic
    
    let message;
    try {
        // Fetch current votes
        const votes = gameState.players.filter(p => p.vote && p.vote !== 'abstain' && p.status === 'alive').map(p => p.vote);
        const voteCounts = votes.reduce((acc, id) => {
            acc[id] = (acc[id] || 0) + 1;
            return acc;
        }, {});

        const sortedVotes = Object.entries(voteCounts).sort(([, countA], [, countB]) => countB - countA);
        
        // Total alive players excluding self for majority calculation (simplified for now)
        const totalAlive = gameState.players.filter(p => p.status === 'alive').length;

        if (sortedVotes.length > 0 && sortedVotes[0][1] > totalAlive / 2) {
            const lynchTargetId = sortedVotes[0][0];
            const lynchTarget = gameState.players.find(p => p.id === lynchTargetId);
            
            // Update status of the killed player
            const updatedPlayers = gameState.players.map(p => 
                p.id === lynchTargetId ? { ...p, status: 'dead', vote: null } : p
            );
            
            const targetRole = ALL_ROLES[gameState.roles[lynchTargetId]].name;
            message = `${lynchTarget.alias}, the ${targetRole}, was lynched!`;
            
            await updateDoc(doc(db, getLobbyPath(lobbyCode)), {
                players: updatedPlayers,
                log: arrayUnion({ type: 'lynch', message: message }),
            });

        } else {
            message = 'No one was lynched today. The village is confused.';
            await updateDoc(doc(db, getLobbyPath(lobbyCode)), {
                log: arrayUnion({ type: 'lynch', message: message }),
            });
        }
        
        // Advance to next phase
        await window.advancePhase();

    } catch (e) {
        console.error("Error tallying votes: ", e);
    }
}

async function advancePhase() {
    if (!isHost) return;
    
    let nextPhase = gameState.phase === 'NIGHT' ? 'DAY' : 'NIGHT';
    let nextDayNum = nextPhase === 'NIGHT' ? gameState.dayNum + 1 : gameState.dayNum;
    let logMessage = nextPhase === 'NIGHT' ? `It is now Night ${nextDayNum}.` : `It is now Day ${nextDayNum}. Discussion begins.`;
    
    // Simplified: In a real game, 'NIGHT' results would be calculated here (kill, heal, etc.)
    if (gameState.phase === 'NIGHT') {
        // For demonstration, let's just log a message
        const resultsMessage = "The night passed without incident. Night actions (kill/heal/investigate) were carried out.";
        gameState.log.push({ type: 'night-report', message: resultsMessage });
        
        // In a real game, you would now read the actions collection and apply results,
        // then delete the actions collection for the next night.
    }

    await updateDoc(doc(db, getLobbyPath(lobbyCode)), {
        phase: nextPhase,
        dayNum: nextDayNum,
        log: arrayUnion({ type: 'info', message: logMessage }),
        chat: { public: [], mafia: [] }, // Clear chat for new phase
        // Clear all player votes and actions
        players: gameState.players.map(p => ({...p, vote: null}))
    });
    selectedTargetId = null; // Clear selection
}

// --- CHAT MANAGEMENT ---
function sendMessage(channel) {
    const inputId = channel === 'public' ? 'public-chat-input' : 'mafia-chat-input';
    const chatInput = document.getElementById(inputId);
    const messageText = chatInput.value.trim();

    if (!messageText) return;

    const newMessage = {
        senderId: userId,
        senderAlias: localStorage.getItem('mafiaAlias'),
        text: messageText,
        timestamp: serverTimestamp(),
    };

    try {
        const chatField = `chat.${channel}`;
        updateDoc(doc(db, getLobbyPath(lobbyCode)), {
            [chatField]: arrayUnion(newMessage)
        });
        chatInput.value = '';
        // The onSnapshot listener will handle the rendering
    } catch (e) {
        console.error(`Error sending message to ${channel} chat: `, e);
    }
}

// --- UI RENDERING ---

function renderUI() {
    document.getElementById('lobby-code-display').textContent = lobbyCode;
    document.getElementById('player-count').textContent = gameState.players.length;
    
    const myPlayer = gameState.players.find(p => p.id === userId);
    isHost = gameState.hostId === userId;
    
    // 1. Lobby Host Controls Visibility
    if (isHost && gameState.phase === 'LOBBY') {
        document.querySelectorAll('.hidden-non-host').forEach(el => el.classList.remove('hidden'));
        document.getElementById('waiting-host-message').classList.add('hidden');
        renderRoleConfig();
    } else if (gameState.phase === 'LOBBY') {
        document.querySelectorAll('.hidden-non-host').forEach(el => el.classList.add('hidden'));
        document.getElementById('waiting-host-message').classList.remove('hidden');
    }

    // 2. Player List (Lobby & Game)
    renderPlayerLists();

    // 3. Game Screen UI updates
    if (gameState.phase !== 'LOBBY') {
        const theme = gameState.phase === 'DAY' ? 'theme-day' : 'theme-night';
        const icon = gameState.phase === 'DAY' ? 'sun' : 'moon';
        const phaseText = gameState.phase === 'DAY' ? `Day ${gameState.dayNum}` : `Night ${gameState.dayNum}`;

        document.getElementById('game-screen').className = `h-[90vh] flex flex-col ${theme}`;
        document.getElementById('phase-display').innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 mr-1"></i> Phase: ${phaseText}`;

        // Update Role Card
        const role = gameState.roles[userId] ? ALL_ROLES[gameState.roles[userId]] : null;
        if (role) {
            myRole = { name: gameState.roles[userId], alignment: role.alignment };
            document.getElementById('my-role-display').textContent = myRole.name.toUpperCase();
            document.getElementById('my-role-desc').textContent = role.desc;
            document.getElementById('my-role-display').style.color = myRole.alignment === 'Mafia' ? '#ff4d4d' : (myRole.alignment === 'Neutral' ? '#FFD700' : 'var(--color-gold-glow)');
        }

        // Phase Specific Panels
        document.getElementById('day-discussion').classList.toggle('hidden', gameState.phase !== 'DAY');
        document.getElementById('night-actions').classList.toggle('hidden', gameState.phase !== 'NIGHT');
        document.getElementById('voting-interface').classList.toggle('hidden', gameState.phase !== 'DAY');
        document.getElementById('tally-votes-btn').classList.toggle('hidden', !isHost || gameState.phase !== 'DAY');

        // Mafia Chat Visibility
        document.getElementById('mafia-chat').classList.toggle('hidden', myRole.alignment !== 'Mafia' || gameState.phase !== 'NIGHT');

        // Render Chat and Actions
        renderChat('public', gameState.chat.public || []);
        if (myRole.alignment === 'Mafia') {
            renderChat('mafia', gameState.chat.mafia || []);
        }
        
        renderNightActions();
        renderVotingInterface();
        renderGameLog();

        lucide.createIcons(); // Re-render icons after DOM updates
    }
}

function renderRoleConfig() {
    const mafiaContainer = document.getElementById('mafia-roles');
    const townContainer = document.getElementById('town-roles');
    const mafiaRoles = Object.keys(ALL_ROLES).filter(r => ALL_ROLES[r].alignment === 'Mafia');
    const townRoles = Object.keys(ALL_ROLES).filter(r => ALL_ROLES[r].alignment === 'Town' && r !== 'Villager' && r !== 'Creeper'); // Creeper is handled separately, Villager is default
    
    mafiaContainer.innerHTML = '';
    townContainer.innerHTML = '';

    // Handle Villager count separately for the town roles container
     const villagerRole = 'Villager';
     const villagerCount = gameState.config[villagerRole] || 0;
     const villagerDiv = document.createElement('div');
     villagerDiv.className = `flex items-center justify-between p-2 rounded bg-white/5 border border-white/10`;
     villagerDiv.innerHTML = `
         <span class="text-sm">${villagerRole}</span>
         <input type="number" id="role-${villagerRole}" value="${villagerCount}" min="0" max="10" 
                data-role="${villagerRole}" data-alignment="${ALL_ROLES[villagerRole].alignment}"
                class="w-12 text-center bg-black/30 rounded text-sm p-1 role-input border border-white/10">
     `;
     townContainer.appendChild(villagerDiv);


    const createRoleInput = (role, container, accentClass) => {
        const count = gameState.config[role] || 0;
        const div = document.createElement('div');
        div.className = `flex items-center justify-between p-2 rounded bg-white/5 border ${accentClass}`;
        div.innerHTML = `
            <span class="text-sm">${role}</span>
            <input type="number" id="role-${role}" value="${count}" min="0" max="10" 
                   data-role="${role}" data-alignment="${ALL_ROLES[role].alignment}"
                   class="w-12 text-center bg-black/30 rounded text-sm p-1 role-input border ${accentClass}">
        `;
        container.appendChild(div);
    };

    mafiaRoles.forEach(r => createRoleInput(r, mafiaContainer, 'border-red-600/30'));
    townRoles.forEach(r => createRoleInput(r, townContainer, 'border-white/10'));
    
    document.querySelectorAll('.role-input').forEach(input => {
        input.addEventListener('change', (e) => {
            if (isHost) {
                // Optimistically update the config and then save it to Firestore
                gameState.config[e.target.dataset.role] = parseInt(e.target.value);
                updateDoc(doc(db, getLobbyPath(lobbyCode)), { config: gameState.config });
            }
        });
    });
}

function renderPlayerLists() {
    const lobbyList = document.getElementById('player-list');
    const gameList = document.getElementById('game-player-list');
    lobbyList.innerHTML = '';
    gameList.innerHTML = '';
    
    gameState.players.forEach(player => {
        // Lobby Player List
        const isMyPlayer = player.id === userId;
        let lobbyStyle = `p-3 rounded flex items-center`;
        if (isMyPlayer) {
            lobbyStyle += ` bg-white/5 border border-white/10`;
            lobbyStyle += ` style="box-shadow: 0 0 10px rgba(212, 175, 55, 0.4); animation: gold-pulse 2s infinite ease-in-out;"`;
        } else {
            lobbyStyle += ` bg-white/5 border border-white/10`;
        }

        lobbyList.innerHTML += `
            <div class="${lobbyStyle}">
                <i data-lucide="${player.isHost ? 'crown' : 'user'}" class="w-5 h-5 mr-3 ${player.isHost ? 'text-[#d4af37]' : 'text-white/70'}"></i>
                <span class="${player.isHost ? 'font-bold text-[#d4af37]' : ''}">${player.alias} ${isMyPlayer ? '(You)' : ''}</span>
            </div>
        `;
        
        // Game Player List
        const roleInfo = gameState.roles[player.id] ? ALL_ROLES[gameState.roles[player.id]] : null;
        const isDead = player.status === 'dead';
        let playerColor = isDead ? 'text-gray-500' : (roleInfo && roleInfo.alignment === 'Mafia' && myRole.alignment === 'Mafia' ? 'text-red-600' : 'text-green-500');
        
        gameList.innerHTML += `
            <div class="player-entry p-2 rounded bg-white/5 border border-white/10 flex items-center ${isDead ? 'dead' : ''} ${isMyPlayer ? 'border-[#d4af37]' : ''}">
                <i data-lucide="${isDead ? 'skull' : 'circle'}" class="w-4 h-4 mr-2 ${playerColor}"></i>
                <span class="text-sm">${player.alias} ${isMyPlayer ? '(You)' : ''}</span>
            </div>
        `;
    });
}

function renderChat(channel, messages) {
    const chatContainer = document.getElementById(channel === 'public' ? 'public-chat' : 'mafia-chat-messages');
    chatContainer.innerHTML = '';

    // Ensure messages exist and sort them if they have a timestamp
    if (messages && messages.length > 0 && messages[0].timestamp) {
        messages.sort((a, b) => a.timestamp?.toMillis() - b.timestamp?.toMillis());
    }

    messages.forEach(msg => {
        const isMe = msg.senderId === userId;
        const senderColor = isMe ? 'text-white' : (channel === 'mafia' ? 'text-red-400' : 'text-green-400');
        
        chatContainer.innerHTML += `
            <div class="text-sm">
                <span class="font-bold ${senderColor}">${msg.senderAlias}${isMe ? ' (You)' : ''}:</span> ${msg.text}
            </div>
        `;
    });
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function renderNightActions() {
    if (gameState.phase !== 'NIGHT' || myRole.alignment === 'Town' && myRole.name === 'Villager') {
        // Hide actions if it's night but the role has no night action
        document.getElementById('night-actions').classList.add('hidden');
        return;
    }

    const targetList = document.getElementById('night-target-list');
    const actionBtn = document.getElementById('submit-night-action-btn');
    targetList.innerHTML = '';
    
    document.getElementById('night-action-title').textContent = `Night Actions (Role: ${myRole.name})`;
    document.getElementById('night-action-prompt').textContent = `Select a target for your ${myRole.name} action:`;
    actionBtn.textContent = 'Submit Action';
    actionBtn.disabled = true;

    const alivePlayers = gameState.players.filter(p => p.status === 'alive' && p.id !== userId);
    const actionVerb = window.getActionVerb(myRole.name);

    alivePlayers.forEach(player => {
        const isSelected = selectedTargetId === player.id;
        const btnClass = isSelected 
            ? 'w-full text-left p-3 rounded border-[#4acbff] flex items-center bg-white/10'
            : 'w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 transition duration-150 border border-white/10 flex items-center';
        
        targetList.innerHTML += `
            <button class="${btnClass}" data-player-id="${player.id}" onclick="selectTarget('${player.id}')">
                <i data-lucide="crosshair" class="w-4 h-4 mr-3 text-[#4acbff]"></i> ${actionVerb} ${player.alias}
            </button>
        `;
    });
    // Re-render icons since we added new elements to the DOM
    lucide.createIcons();
}

function renderVotingInterface() {
    if (gameState.phase !== 'DAY') return;

    const targetList = document.getElementById('voting-target-list');
    const voteBtn = document.getElementById('submit-vote-btn');
    targetList.innerHTML = '';

    const alivePlayers = gameState.players.filter(p => p.status === 'alive' && p.id !== userId);
    const myVote = gameState.players.find(p => p.id === userId)?.vote;

    alivePlayers.forEach(player => {
        const isSelected = myVote === player.id;
        const btnClass = isSelected 
            ? 'w-full text-left p-3 rounded border-[#d4af37] flex items-center bg-white/10'
            : 'w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 transition duration-150 border border-white/10 flex items-center';
        
        targetList.innerHTML += `
            <button class="${btnClass}" data-player-id="${player.id}" onclick="selectVoteTarget('${player.id}')">
                <i data-lucide="check-circle" class="w-4 h-4 mr-3 text-green-500"></i> Accuse ${player.alias} ${isSelected ? '(Selected)' : ''}
            </button>
        `;
    });
    
    targetList.innerHTML += `
        <button class="${myVote === 'abstain' ? 'w-full text-left p-3 rounded border-gray-600 flex items-center bg-gray-700/50 text-gray-400' : 'w-full text-left p-3 rounded bg-gray-700/50 hover:bg-gray-700 transition duration-150 border border-gray-600/50 flex items-center text-gray-400'}" onclick="selectVoteTarget('abstain')">
            <i data-lucide="x" class="w-4 h-4 mr-3"></i> Skip / Abstain
        </button>
    `;
    
    voteBtn.disabled = !myVote;
    if(myVote) {
         voteBtn.textContent = myVote === 'abstain' ? 'SUBMIT ABSTAIN VOTE' : `SUBMIT VOTE for ${gameState.players.find(p => p.id === myVote).alias}`;
    }
     // Re-render icons since we added new elements to the DOM
    lucide.createIcons();
}

function renderGameLog() {
     const logContainer = document.getElementById('ledger-content');
     logContainer.innerHTML = '';
     
     // Reverse the log to show the latest entries first, then take the first 5
     const recentLog = [...gameState.log].reverse().slice(0, 5); 
     
     recentLog.forEach(entry => {
         const color = entry.type === 'lynch' ? 'text-red-400 font-bold' : 'text-white/70';
         logContainer.innerHTML += `<p class="text-sm ${color}">${entry.message}</p>`;
     });
}

// --- UI INTERACTION FUNCTIONS (Made Global) ---

// Exposing functions to the global window object so they can be called by HTML inline event handlers (onclick)
window.handleLobbyAction = handleLobbyAction;
window.startGame = startGame;
window.tallyVotes = tallyVotes;
window.sendMessage = sendMessage;
window.renderUI = renderUI;
window.advancePhase = advancePhase;

window.submitNightAction = submitNightAction;
window.submitVote = function() {
    if (!selectedTargetId || gameState.phase !== 'DAY') return;
    // The vote is already saved via selectVoteTarget, so just disable the button
    document.getElementById('submit-vote-btn').disabled = true;
    document.getElementById('submit-vote-btn').textContent = 'Vote Locked';
}

window.leaveLobby = function() {
     // Simplified: In a real app, you'd remove the player from the array in Firestore
     lobbyCode = '';
     isHost = false;
     window.switchScreen('landing-screen');
}

window.selectTarget = function(targetId) {
    selectedTargetId = targetId;
    const targetAlias = gameState.players.find(p => p.id === targetId).alias;
    document.getElementById('submit-night-action-btn').textContent = `Submit Action for ${targetAlias}`;
    document.getElementById('submit-night-action-btn').disabled = false;
    renderNightActions(); // Re-render to highlight selection
}

window.selectVoteTarget = async function(targetId) {
    selectedTargetId = targetId;
    const lobbyRef = doc(db, getLobbyPath(lobbyCode));
    
    // Optimistically update the vote locally for immediate UI feedback
    const myPlayer = gameState.players.find(p => p.id === userId);
    if(myPlayer) {
        myPlayer.vote = targetId;
    }
    renderVotingInterface();
    
    // Save the vote to Firestore
    await updateDoc(lobbyRef, {
        players: gameState.players.map(p => p.id === userId ? { ...p, vote: targetId } : p)
    });
}

window.copyCode = function(elementId) {
    const textToCopy = document.getElementById(elementId).textContent;
    // Use execCommand for broader compatibility in iFrames
    const tempInput = document.createElement('textarea');
    tempInput.value = textToCopy;
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
        document.execCommand('copy');
        const btn = document.querySelector(`#${elementId} + button`);
        const originalIcon = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-green-500"></i>`;
        lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = originalIcon;
            lucide.createIcons();
        }, 1500);
    } catch (err) {
        console.error('Copy failed: ', err);
    } finally {
        document.body.removeChild(tempInput);
    }
}

window.switchScreen = function(targetScreenId) {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('landing-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    
    document.getElementById(targetScreenId).classList.remove('hidden');
    lucide.createIcons();
}

// --- HELPER FUNCTIONS (Made Global) ---
window.getLobbyPath = getLobbyPath;
window.getActionPath = getActionPath;
window.shuffleArray = shuffleArray;
window.getActionVerb = getActionVerb;

function getLobbyPath(code) {
    return `/artifacts/${appId}/public/data/lobbies/${code}`;
}
function getActionPath(code, dayNum, playerId) {
    return `/artifacts/${appId}/public/data/actions/${code}/Night_${dayNum}/${playerId}`;
}
function generateRandomCode(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
function getActionVerb(roleName) {
    switch (roleName) {
        case 'Detective': return 'Investigate';
        case 'Doctor': return 'Heal';
        case 'Jailer': return 'Detain';
        case 'Bodyguard': return 'Guard';
        case 'Priest': return 'Cleanse';
        case 'Godfather':
        case 'Mafioso': return 'Kill';
        case 'Consigliere': return 'Identify';
        case 'Blackmailer': return 'Silence';
        case 'Creeper': return 'Block';
        default: return 'Target';
    }
}

// --- STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
     // Retrieve alias from local storage if exists
    const savedAlias = localStorage.getItem('mafiaAlias');
    if (savedAlias) {
        document.getElementById('player-alias-input').value = savedAlias;
    }
    initFirebase();
});