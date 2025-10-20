import React from 'react';
import defaultChat from '../icons/default_chat.png';

export const Dashito = ({ className = '' }) => {
  const containerClassName = ['dashito', className].filter(Boolean).join(' ');

  return (
    <section className={containerClassName} aria-label="Vista de inicio del chat">
      <div className="dashito__content">
        <img
          className="dashito__image"
          src={defaultChat}
          alt="Ilustración de chat por defecto"
        />
        <p className="dashito__caption">Selecciona chat para comenzar</p>
      </div>
    </section>
  );
};
