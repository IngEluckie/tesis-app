// chat,js

import React, { useState } from 'react'
import { Navbar } from './chatLayout/navbar'
import { Chatsbar } from './chatLayout/chatsbar'
import { Chatbox } from './chatLayout/chatbox'
import { UserInfo } from './chatLayout/userInfo'
import { useSession } from '../context/sessionContext'
import { Settings } from './chatLayout/settings'

// Styles
import './chatLayout/chat-styles.css'


export const Chat = () => {

  const { userData, isSessionReady, jwt } = useSession()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <div className='chat-page'>
        <div className='nava'>
            <Navbar onOpenSettings={() => setIsSettingsOpen(true)} />
        </div>
        <div className='main-container'>
            <Chatsbar className="chats-bar" />
            <Chatbox className="chatbox" />
            <UserInfo className="user-info" />
        </div>
        <Settings
          className="settings-box"
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
    </div>
  )
}
