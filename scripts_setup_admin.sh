#!/usr/bin/env bash
set -e
if [ -z "$1" ]; then echo 'Uso: ./scripts_setup_admin.sh "SUA_SENHA_FORTE"'; exit 1; fi
node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync(process.argv[1],12))" "$1"
