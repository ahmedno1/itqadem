export function createVoiceChat({ socket, getState, getSession, getConnectionStatus, setMessage, getButtonLabel }) {
  const voiceConnections = new Map();
  let localVoiceStream = null;
  let voiceStreamRequest = null;
  let voicePressed = false;
  let onlineSpeakingSent = false;

  function setVoiceTrackEnabled(enabled) {
    if (localVoiceStream) {
      localVoiceStream.getAudioTracks().forEach((track) => { track.enabled = enabled; });
    }
    document.querySelectorAll('[data-action="online-ptt"]').forEach((button) => {
      button.classList.toggle('is-pressed', enabled);
      button.setAttribute('aria-pressed', String(enabled));
      button.textContent = getButtonLabel(enabled);
    });
    if (!enabled && !socket.connected) onlineSpeakingSent = false;
    if (socket.connected && getSession() && enabled !== onlineSpeakingSent && (!enabled || localVoiceStream)) {
      socket.emit('voiceSpeaking', { active: enabled });
      onlineSpeakingSent = enabled;
    }
  }

  function closeVoiceConnection(peerSocketId, peer) {
    peer.connection.ontrack = null;
    peer.connection.onicecandidate = null;
    peer.connection.onnegotiationneeded = null;
    peer.connection.close();
    peer.remoteAudio?.remove();
    voiceConnections.delete(peerSocketId);
  }

  function sendVoiceSignal(targetSocketId, signal) {
    socket.emit('voiceSignal', { targetSocketId, signal });
  }

  function createVoiceConnection(peerInfo) {
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    const peer = {
      connection,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      pendingCandidates: [],
      polite: socket.id.localeCompare(peerInfo.socketId) > 0,
      remoteAudio: null
    };
    voiceConnections.set(peerInfo.socketId, peer);

    connection.onicecandidate = (event) => {
      if (event.candidate) sendVoiceSignal(peerInfo.socketId, { type: 'candidate', candidate: event.candidate.toJSON() });
    };
    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        sendVoiceSignal(peerInfo.socketId, { type: 'description', description: connection.localDescription.toJSON() });
      } catch (error) {
        console.warn('Unable to negotiate the voice connection:', error);
      } finally {
        peer.makingOffer = false;
      }
    };
    connection.ontrack = (event) => {
      if (!peer.remoteAudio) {
        peer.remoteAudio = document.createElement('audio');
        peer.remoteAudio.autoplay = true;
        peer.remoteAudio.playsInline = true;
        peer.remoteAudio.dataset.voicePeer = peerInfo.socketId;
        document.body.appendChild(peer.remoteAudio);
      }
      peer.remoteAudio.srcObject = event.streams[0];
      peer.remoteAudio.play().catch(() => {});
    };

    if (localVoiceStream) {
      localVoiceStream.getAudioTracks().forEach((track) => connection.addTrack(track, localVoiceStream));
    }
    return peer;
  }

  function sync(state) {
    const peers = Array.isArray(state.voicePeers) ? state.voicePeers : [];
    const activePeerIds = new Set(peers.map((peer) => peer.socketId).filter((id) => id && id !== socket.id));
    for (const [peerSocketId, peer] of voiceConnections) {
      if (!activePeerIds.has(peerSocketId)) closeVoiceConnection(peerSocketId, peer);
    }
    if (typeof RTCPeerConnection !== 'undefined') {
      peers.forEach((peerInfo) => {
        if (peerInfo.socketId !== socket.id && !voiceConnections.has(peerInfo.socketId)) createVoiceConnection(peerInfo);
      });
    }
    if (!canUsePushToTalk(state)) {
      voicePressed = false;
      setVoiceTrackEnabled(false);
    }
  }

  function canUsePushToTalk(state = getState()) {
    return Boolean(state && getSession() && getConnectionStatus() === 'connected');
  }

  async function start() {
    if (!canUsePushToTalk()) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('المتصفح لا يدعم استخدام الميكروفون في هذه الصفحة.');
      return;
    }
    voicePressed = true;
    setVoiceTrackEnabled(true);
    try {
      if (!localVoiceStream) {
        voiceStreamRequest ||= navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        localVoiceStream = await voiceStreamRequest;
        voiceStreamRequest = null;
        localVoiceStream.getAudioTracks().forEach((track) => { track.enabled = voicePressed && canUsePushToTalk(); });
        voiceConnections.forEach((peer) => {
          localVoiceStream.getAudioTracks().forEach((track) => {
            if (!peer.connection.getSenders().some((sender) => sender.track === track)) peer.connection.addTrack(track, localVoiceStream);
          });
        });
      }
      setVoiceTrackEnabled(voicePressed && canUsePushToTalk());
    } catch (error) {
      voiceStreamRequest = null;
      voicePressed = false;
      setVoiceTrackEnabled(false);
      setMessage('تعذر تشغيل الميكروفون. تحقق من الإذن واستخدام اتصال آمن.');
    }
  }

  function stop() {
    voicePressed = false;
    setVoiceTrackEnabled(false);
  }

  function closePeers() {
    voiceConnections.forEach((peer, peerSocketId) => closeVoiceConnection(peerSocketId, peer));
  }

  function closeAll() {
    closePeers();
    if (localVoiceStream) localVoiceStream.getTracks().forEach((track) => track.stop());
    localVoiceStream = null;
    voiceStreamRequest = null;
    voicePressed = false;
  }

  async function handleSignal(from, signal) {
    const peer = voiceConnections.get(from);
    if (!peer || !signal) return;
    const connection = peer.connection;
    try {
      if (signal.type === 'description') {
        const description = signal.description;
        const readyForOffer = !peer.makingOffer
          && (connection.signalingState === 'stable' || peer.settingRemoteAnswer);
        const offerCollision = description.type === 'offer' && !readyForOffer;
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        if (offerCollision && peer.polite) await connection.setLocalDescription({ type: 'rollback' });
        peer.settingRemoteAnswer = description.type === 'answer';
        await connection.setRemoteDescription(description);
        peer.settingRemoteAnswer = false;
        for (const candidate of peer.pendingCandidates.splice(0)) {
          await connection.addIceCandidate(candidate);
        }
        if (description.type === 'offer') {
          await connection.setLocalDescription();
          sendVoiceSignal(from, { type: 'description', description: connection.localDescription.toJSON() });
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (!connection.remoteDescription) {
          peer.pendingCandidates.push(signal.candidate);
          return;
        }
        try {
          await connection.addIceCandidate(signal.candidate);
        } catch (error) {
          if (!peer.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.warn('Unable to apply the voice signal:', error);
    }
  }

  function handleDisconnect() {
    onlineSpeakingSent = false;
    closePeers();
    stop();
  }

  return { sync, start, stop, closeAll, closePeers, handleSignal, handleDisconnect, isPressed: () => voicePressed };
}
