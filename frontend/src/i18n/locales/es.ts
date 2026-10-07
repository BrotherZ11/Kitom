export const es = {
  common: {
    loading: 'Cargando…',
  },
  auth: {
    fields: {
      email: 'Email',
      password: 'Contraseña',
      newPassword: 'Nueva contraseña',
    },
    google: {
      continue: 'Continuar con Google',
    },
    callback: {
      processing: 'Verificando el enlace…',
      emailConfirmed: 'Tu email está confirmado. Ya puedes iniciar sesión.',
      goToLogin: 'Ir a iniciar sesión',
    },
    updatePassword: {
      title: 'Nueva contraseña',
      description: 'Elige una contraseña nueva para tu cuenta.',
      submit: 'Guardar contraseña',
      cancel: 'Cancelar y cerrar sesión',
    },
    login: {
      title: 'Iniciar sesión',
      submit: 'Entrar',
      goToRegister: '¿No tienes cuenta? Regístrate',
      goToForgotPassword: '¿Has olvidado tu contraseña?',
    },
    register: {
      title: 'Crear cuenta',
      submit: 'Crear cuenta',
      goToLogin: '¿Ya tienes cuenta? Inicia sesión',
      checkEmail: 'Te hemos enviado un email para confirmar tu cuenta. Ábrelo y después inicia sesión.',
    },
    forgotPassword: {
      title: 'Recuperar contraseña',
      description: 'Introduce tu email y te enviaremos instrucciones para restablecer la contraseña.',
      submit: 'Enviar instrucciones',
      sent: 'Si existe una cuenta con ese email, recibirás un mensaje con instrucciones.',
      backToLogin: 'Volver a iniciar sesión',
    },
    errors: {
      missing_fields: 'Completa todos los campos.',
      invalid_email: 'Introduce un email válido.',
      invalid_credentials: 'Email o contraseña incorrectos.',
      email_already_registered: 'Ya existe una cuenta con este email.',
      weak_password: 'La contraseña no es suficientemente segura. Prueba con una más larga.',
      same_password: 'La nueva contraseña debe ser distinta de la anterior.',
      email_not_confirmed: 'Confirma tu email antes de iniciar sesión.',
      link_invalid:
        'El enlace ha caducado o ya se ha usado. Ábrelo en el mismo dispositivo donde lo pediste o solicita uno nuevo.',
      oauth_failed: 'No se ha podido iniciar sesión con Google. Inténtalo de nuevo.',
      rate_limited: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
      signup_disabled: 'El registro no está disponible en este momento.',
      network: 'No hay conexión. Comprueba tu red e inténtalo de nuevo.',
      unknown: 'Algo ha salido mal. Inténtalo de nuevo.',
    },
  },
  home: {
    title: 'Sesión activa',
    signedInAs: 'Has iniciado sesión como',
    placeholder: 'Aquí irá la pantalla de inicio de KITOM.',
    signOut: 'Cerrar sesión',
  },
};

/** Forma que debe cumplir cualquier idioma nuevo (p. ej. `en`). */
export type Translations = typeof es;
