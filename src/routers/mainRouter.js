// mainRouter.js

import React from 'react'
import { Route, Link, BrowserRouter, Routes } from 'react-router'
import { Chat } from '../components/chat'
import { AuthGate } from '../components/authGate'
import { NotFound } from '../components/notFound'

export const MainRouter = () => {
  return (
    <BrowserRouter>
        <Routes>
            <Route path='/' element={(
              <AuthGate>
                <Chat/>
              </AuthGate>
            )} />
            <Route path='*' element={<NotFound/>}/>
        </Routes>
    </BrowserRouter>
  )
}
