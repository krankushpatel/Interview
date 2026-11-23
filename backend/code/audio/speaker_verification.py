try:
    from resemblyzer import VoiceEncoder
except (ImportError, OSError):
    VoiceEncoder = None
import numpy as np

class SpeakerVerifier:
    def __init__(self):
        self.encoder = VoiceEncoder() if VoiceEncoder is not None else None
        self.reference_embedding = None
        self.threshold = 0.75
        
    def enroll(self, audio_array: np.ndarray) -> None:
        """Enrollment: Store reference voice"""
        if self.encoder is None:
            return
        self.reference_embedding = self.encoder.embed_utterance(audio_array)
        
    def verify(self, audio_array: np.ndarray) -> tuple:
        """Verification: Check if same speaker"""
        if self.encoder is None:
            return True, 1.0
        if self.reference_embedding is None:
            return False, 0.0
            
        test_embedding = self.encoder.embed_utterance(audio_array)
        
        # Cosine similarity
        similarity = np.dot(self.reference_embedding, test_embedding) / (
            np.linalg.norm(self.reference_embedding) * 
            np.linalg.norm(test_embedding)
        )
        
        is_same = similarity >= self.threshold
        return is_same, similarity