export function createAudioManager(isEnabled) {
  let audioContext = null;

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext ||= new AudioContextClass();
    audioContext.resume();
    return audioContext;
  }

  function prime() {
    try {
      getAudioContext();
    } catch (error) {
      console.warn('Unable to enable online audio:', error);
    }
  }

  function playOutcome(decision) {
    if (!isEnabled()) return;
    try {
      const context = getAudioContext();
      if (!context) return;
      const notes = decision === 'accept' ? [523.25, 659.25, 783.99] : [392, 293.66, 220];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = context.currentTime + index * 0.13;
        oscillator.frequency.value = frequency;
        oscillator.type = 'triangle';
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.23);
      });
    } catch (error) {
      console.warn('Unable to play the online result sound:', error);
    }
  }

  function playDefenseCountdownTick() {
    if (!isEnabled()) return;
    try {
      const context = getAudioContext();
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.17);
    } catch (error) {
      console.warn('Unable to play the defense countdown:', error);
    }
  }

  function playEliminationSpinTick(progress = 0.5) {
    if (!isEnabled()) return;
    try {
      const context = getAudioContext();
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'square';
      oscillator.frequency.value = 145 + Math.round(progress * 120);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.09);
    } catch (error) {
      console.warn('Unable to play the elimination wheel sound:', error);
    }
  }

  return { prime, playOutcome, playDefenseCountdownTick, playEliminationSpinTick };
}
