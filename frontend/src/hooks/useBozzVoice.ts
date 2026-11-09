import { useContext } from 'react'
import { BozzVoiceContext, type BozzVoice } from '../context/BozzVoiceContext'

export function useBozzVoice(): BozzVoice {
  const ctx = useContext(BozzVoiceContext)
  if (!ctx) throw new Error('useBozzVoice must be used inside BozzVoiceProvider')
  return ctx
}
